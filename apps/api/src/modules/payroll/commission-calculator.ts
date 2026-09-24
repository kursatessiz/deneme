import { Prisma } from '@platform/database';
import type { CommissionType } from '@platform/database';

/**
 * Pure trainer commission calculator (W14). No database or NestJS
 * dependency: the payroll service builds these inputs from Prisma rows and
 * feeds them in. See docs/PAYROLL.md for the formula in prose.
 *
 * Rule precedence: a ServiceType's own commissionRuleId always overrides the
 * TrainerProfile's commissionRuleId for a session of that service. A session
 * with neither rule set earns nothing (no commissionRule assigned yet).
 *
 * Substitutions: callers must build CommissionSessionInput from
 * SessionSchedule.trainerId (the trainer who actually taught), never
 * originalTrainerId. The teaching trainer earns the session.
 */

export type CommissionBookingStatus = 'CONFIRMED' | 'ATTENDED' | 'CANCELLED_EARLY' | 'CANCELLED_LATE' | 'NO_SHOW' | 'WAITLIST';

export interface CommissionRuleInput {
  id: string;
  type: CommissionType;
  /** Amount (currency) for PER_SESSION_FIXED/MONTHLY_SALARY, percent 0-100 for PERCENTAGE. */
  value: string | number | Prisma.Decimal;
}

export type CommissionEntitlementKind = 'SESSION_COUNT' | 'TIME_UNLIMITED' | 'CREDIT';

export interface CommissionPackageInput {
  price: string | number | Prisma.Decimal;
  entitlementKind: CommissionEntitlementKind;
  /** Sessions/credits for SESSION_COUNT/CREDIT; ignored (may be null) for TIME_UNLIMITED. */
  totalUnits: number | null;
  /** Used as the unit-price denominator for TIME_UNLIMITED packages. */
  validityDays: number;
}

export interface CommissionBookingInput {
  bookingId: string;
  status: CommissionBookingStatus;
  /** Units the booking would burn from its package (0 if none). */
  unitsCharged: number;
  /** Units the business keeps for a late cancellation. */
  penaltyUnits: number;
  /** Null when the booking was not paid from a member package. */
  package: CommissionPackageInput | null;
}

export interface CommissionSessionInput {
  scheduleId: string;
  serviceTypeName: string;
  startTime: Date;
  /** Overrides trainerRule when set. */
  serviceTypeRule: CommissionRuleInput | null;
  trainerRule: CommissionRuleInput | null;
  bookings: CommissionBookingInput[];
}

export interface CommissionLineDetail {
  scheduleId: string;
  bookingId: string | null;
  serviceTypeName: string;
  startTime: Date;
  ruleType: CommissionType;
  ruleSource: 'SERVICE_TYPE' | 'TRAINER';
  units: number;
  unitPrice: Prisma.Decimal | null;
  /** Exact (unrounded) contribution of this line. */
  amount: Prisma.Decimal;
}

export interface CommissionCalculationResult {
  /** Distinct sessions passed in, regardless of whether a rule applied. */
  sessions: number;
  /** ATTENDED bookings across all sessions. */
  attendees: number;
  /** Sum of every detail line, rounded half-up to 2 decimals here only. */
  grossAmount: Prisma.Decimal;
  details: CommissionLineDetail[];
}

function resolveRule(
  serviceTypeRule: CommissionRuleInput | null,
  trainerRule: CommissionRuleInput | null,
): { rule: CommissionRuleInput; source: 'SERVICE_TYPE' | 'TRAINER' } | null {
  if (serviceTypeRule) return { rule: serviceTypeRule, source: 'SERVICE_TYPE' };
  if (trainerRule) return { rule: trainerRule, source: 'TRAINER' };
  return null;
}

/**
 * Units actually consumed by a booking for revenue purposes: the full
 * charge for ATTENDED/NO_SHOW, only the kept penalty for CANCELLED_LATE
 * (the rest was refunded to the member's package), zero otherwise.
 */
function unitsConsumed(booking: CommissionBookingInput): number {
  if (booking.status === 'ATTENDED' || booking.status === 'NO_SHOW') return booking.unitsCharged;
  if (booking.status === 'CANCELLED_LATE') return booking.penaltyUnits;
  return 0;
}

/**
 * Price of one package unit. TIME_UNLIMITED packages have no unit count, so
 * we prorate the price over the package's validity, one day standing in for
 * one unit (documented in docs/PAYROLL.md).
 */
function unitPrice(pkg: CommissionPackageInput): Prisma.Decimal {
  const price = new Prisma.Decimal(pkg.price);
  if (pkg.entitlementKind === 'TIME_UNLIMITED') {
    return price.div(pkg.validityDays);
  }
  const totalUnits = pkg.totalUnits ?? 0;
  if (totalUnits <= 0) return new Prisma.Decimal(0);
  return price.div(totalUnits);
}

export function calculateTrainerCommission(sessions: readonly CommissionSessionInput[]): CommissionCalculationResult {
  const details: CommissionLineDetail[] = [];
  const monthlySalaryRuleIdsCounted = new Set<string>();
  let grossExact = new Prisma.Decimal(0);
  let attendees = 0;

  for (const session of sessions) {
    attendees += session.bookings.filter((b) => b.status === 'ATTENDED').length;

    const resolved = resolveRule(session.serviceTypeRule, session.trainerRule);
    if (!resolved) continue;
    const { rule, source } = resolved;

    if (rule.type === 'PER_SESSION_FIXED') {
      const amount = new Prisma.Decimal(rule.value);
      grossExact = grossExact.add(amount);
      details.push({
        scheduleId: session.scheduleId,
        bookingId: null,
        serviceTypeName: session.serviceTypeName,
        startTime: session.startTime,
        ruleType: rule.type,
        ruleSource: source,
        units: 0,
        unitPrice: null,
        amount,
      });
      continue;
    }

    if (rule.type === 'MONTHLY_SALARY') {
      // Paid once per period regardless of session count: only the first
      // session that resolves to a given salary rule contributes it.
      if (monthlySalaryRuleIdsCounted.has(rule.id)) continue;
      monthlySalaryRuleIdsCounted.add(rule.id);
      const amount = new Prisma.Decimal(rule.value);
      grossExact = grossExact.add(amount);
      details.push({
        scheduleId: session.scheduleId,
        bookingId: null,
        serviceTypeName: session.serviceTypeName,
        startTime: session.startTime,
        ruleType: rule.type,
        ruleSource: source,
        units: 0,
        unitPrice: null,
        amount,
      });
      continue;
    }

    // PERCENTAGE: sum, per booking, unit price times units consumed, then
    // apply the percentage. Bookings without a package contribute 0.
    for (const booking of session.bookings) {
      const units = unitsConsumed(booking);
      if (units <= 0 || !booking.package) continue;

      const price = unitPrice(booking.package);
      const bookingRevenue = price.mul(units);
      const amount = bookingRevenue.mul(new Prisma.Decimal(rule.value)).div(100);
      grossExact = grossExact.add(amount);
      details.push({
        scheduleId: session.scheduleId,
        bookingId: booking.bookingId,
        serviceTypeName: session.serviceTypeName,
        startTime: session.startTime,
        ruleType: rule.type,
        ruleSource: source,
        units,
        unitPrice: price,
        amount,
      });
    }
  }

  return {
    sessions: sessions.length,
    attendees,
    grossAmount: grossExact.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    details,
  };
}
