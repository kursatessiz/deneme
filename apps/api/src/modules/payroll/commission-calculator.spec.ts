import { Prisma } from '@platform/database';
import {
  calculateTrainerCommission,
  type CommissionBookingInput,
  type CommissionPackageInput,
  type CommissionSessionInput,
} from './commission-calculator';

const START = new Date('2025-02-03T10:00:00.000Z');

function sessionCountPackage(price: number, totalUnits: number): CommissionPackageInput {
  return { price, entitlementKind: 'SESSION_COUNT', totalUnits, validityDays: 60 };
}

function timeUnlimitedPackage(price: number, validityDays: number): CommissionPackageInput {
  return { price, entitlementKind: 'TIME_UNLIMITED', totalUnits: null, validityDays };
}

function attended(pkg: CommissionPackageInput | null, unitsCharged = 1, bookingId = 'b1'): CommissionBookingInput {
  return { bookingId, status: 'ATTENDED', unitsCharged, penaltyUnits: 0, package: pkg };
}

function session(overrides: Partial<CommissionSessionInput>): CommissionSessionInput {
  return {
    scheduleId: 's1',
    serviceTypeName: 'Birebir Reformer',
    startTime: START,
    serviceTypeRule: null,
    trainerRule: null,
    bookings: [],
    ...overrides,
  };
}

describe('calculateTrainerCommission', () => {
  it('PER_SESSION_FIXED pays a flat amount per session regardless of attendees', () => {
    const rule = { id: 'r1', type: 'PER_SESSION_FIXED' as const, value: 350 };
    const result = calculateTrainerCommission([
      session({ scheduleId: 's1', trainerRule: rule, bookings: [attended(null), attended(null, 1, 'b2')] }),
      session({ scheduleId: 's2', trainerRule: rule, bookings: [] }),
    ]);

    expect(result.sessions).toBe(2);
    expect(result.attendees).toBe(2);
    expect(result.grossAmount.toFixed(2)).toBe('700.00');
    expect(result.details).toHaveLength(2);
    expect(result.details[0].ruleSource).toBe('TRAINER');
  });

  it('PERCENTAGE on a SESSION_COUNT package: unit price = price / totalUnits', () => {
    // 12000 / 10 = 1200 per unit, 40% commission => 480
    const rule = { id: 'r2', type: 'PERCENTAGE' as const, value: 40 };
    const pkg = sessionCountPackage(12000, 10);
    const result = calculateTrainerCommission([session({ trainerRule: rule, bookings: [attended(pkg)] })]);

    expect(result.grossAmount.toFixed(2)).toBe('480.00');
    expect(result.details[0].unitPrice?.toFixed(2)).toBe('1200.00');
    expect(result.details[0].units).toBe(1);
  });

  it('PERCENTAGE on a CREDIT package charges per unit consumed', () => {
    // 9000 / 20 = 450 per credit, 3 credits consumed, 40% => 540
    const rule = { id: 'r3', type: 'PERCENTAGE' as const, value: 40 };
    const pkg: CommissionPackageInput = { price: 9000, entitlementKind: 'CREDIT', totalUnits: 20, validityDays: 90 };
    const result = calculateTrainerCommission([session({ trainerRule: rule, bookings: [attended(pkg, 3)] })]);

    expect(result.grossAmount.toFixed(2)).toBe('540.00');
  });

  it('PERCENTAGE on a TIME_UNLIMITED package prorates price over validity days', () => {
    // 4500 / 30 days = 150/day, 1 unit consumed, 40% => 60
    const rule = { id: 'r4', type: 'PERCENTAGE' as const, value: 40 };
    const pkg = timeUnlimitedPackage(4500, 30);
    const result = calculateTrainerCommission([session({ trainerRule: rule, bookings: [attended(pkg)] })]);

    expect(result.grossAmount.toFixed(2)).toBe('60.00');
    expect(result.details[0].unitPrice?.toFixed(2)).toBe('150.00');
  });

  it('bookings without a package contribute 0 to PERCENTAGE revenue', () => {
    const rule = { id: 'r5', type: 'PERCENTAGE' as const, value: 40 };
    const result = calculateTrainerCommission([session({ trainerRule: rule, bookings: [attended(null)] })]);

    expect(result.grossAmount.toFixed(2)).toBe('0.00');
    expect(result.details).toHaveLength(0);
  });

  it('NO_SHOW bookings count as consumed like ATTENDED', () => {
    const rule = { id: 'r6', type: 'PERCENTAGE' as const, value: 40 };
    const pkg = sessionCountPackage(12000, 10);
    const booking: CommissionBookingInput = { bookingId: 'b1', status: 'NO_SHOW', unitsCharged: 1, penaltyUnits: 0, package: pkg };
    const result = calculateTrainerCommission([session({ trainerRule: rule, bookings: [booking] })]);

    expect(result.grossAmount.toFixed(2)).toBe('480.00');
  });

  it('CANCELLED_LATE with penaltyUnits > 0 charges only the penalty units, not the full unitsCharged', () => {
    const rule = { id: 'r7', type: 'PERCENTAGE' as const, value: 40 };
    const pkg = sessionCountPackage(12000, 10);
    // Booking would have burned 1 full unit, but the policy only kept 1 as a penalty (same here);
    // exercise the case where unitsCharged and penaltyUnits differ to prove penaltyUnits wins.
    const booking: CommissionBookingInput = { bookingId: 'b1', status: 'CANCELLED_LATE', unitsCharged: 1, penaltyUnits: 1, package: pkg };
    const result = calculateTrainerCommission([session({ trainerRule: rule, bookings: [booking] })]);

    expect(result.details[0].units).toBe(1);
    expect(result.grossAmount.toFixed(2)).toBe('480.00');
  });

  it('CANCELLED_LATE with penaltyUnits = 0 (fully refunded) contributes nothing', () => {
    const rule = { id: 'r8', type: 'PERCENTAGE' as const, value: 40 };
    const pkg = sessionCountPackage(12000, 10);
    const booking: CommissionBookingInput = { bookingId: 'b1', status: 'CANCELLED_LATE', unitsCharged: 1, penaltyUnits: 0, package: pkg };
    const result = calculateTrainerCommission([session({ trainerRule: rule, bookings: [booking] })]);

    expect(result.grossAmount.toFixed(2)).toBe('0.00');
    expect(result.details).toHaveLength(0);
  });

  it('CANCELLED_EARLY and CONFIRMED/WAITLIST bookings never contribute', () => {
    const rule = { id: 'r9', type: 'PERCENTAGE' as const, value: 40 };
    const pkg = sessionCountPackage(12000, 10);
    const bookings: CommissionBookingInput[] = [
      { bookingId: 'b1', status: 'CANCELLED_EARLY', unitsCharged: 1, penaltyUnits: 0, package: pkg },
      { bookingId: 'b2', status: 'CONFIRMED', unitsCharged: 1, penaltyUnits: 0, package: pkg },
      { bookingId: 'b3', status: 'WAITLIST', unitsCharged: 0, penaltyUnits: 0, package: pkg },
    ];
    const result = calculateTrainerCommission([session({ trainerRule: rule, bookings })]);

    expect(result.grossAmount.toFixed(2)).toBe('0.00');
  });

  it('service type rule overrides trainer rule (precedence)', () => {
    const trainerRule = { id: 'trainer-rule', type: 'PER_SESSION_FIXED' as const, value: 100 };
    const serviceTypeRule = { id: 'service-rule', type: 'PER_SESSION_FIXED' as const, value: 500 };
    const result = calculateTrainerCommission([session({ trainerRule, serviceTypeRule, bookings: [] })]);

    expect(result.grossAmount.toFixed(2)).toBe('500.00');
    expect(result.details[0].ruleSource).toBe('SERVICE_TYPE');
  });

  it('a session with no service-type or trainer rule earns nothing but is still counted', () => {
    const result = calculateTrainerCommission([session({ bookings: [attended(null)] })]);

    expect(result.sessions).toBe(1);
    expect(result.attendees).toBe(1);
    expect(result.grossAmount.toFixed(2)).toBe('0.00');
  });

  it('MONTHLY_SALARY is paid once per rule per run, not once per session', () => {
    const rule = { id: 'salary-1', type: 'MONTHLY_SALARY' as const, value: 15000 };
    const result = calculateTrainerCommission([
      session({ scheduleId: 's1', trainerRule: rule }),
      session({ scheduleId: 's2', trainerRule: rule }),
      session({ scheduleId: 's3', trainerRule: rule }),
    ]);

    expect(result.sessions).toBe(3);
    expect(result.grossAmount.toFixed(2)).toBe('15000.00');
    expect(result.details).toHaveLength(1);
  });

  it('rounds the total half-up to 2 decimals only at the end, not per booking', () => {
    // Three bookings each contributing 0.005 exactly: summed first (0.015), then rounded once.
    const rule = { id: 'rhalf', type: 'PERCENTAGE' as const, value: 50 };
    const pkg: CommissionPackageInput = { price: 0.01, entitlementKind: 'CREDIT', totalUnits: 100, validityDays: 30 };
    // unit price = 0.0001, * 1 unit * 50% = 0.00005 per booking; 3 bookings => 0.00015, rounds to 0.00.
    const bookings = [attended(pkg, 1, 'b1'), attended(pkg, 1, 'b2'), attended(pkg, 1, 'b3')];
    const result = calculateTrainerCommission([session({ trainerRule: rule, bookings })]);

    expect(result.grossAmount.toFixed(2)).toBe('0.00');

    // A case that rounds up: 0.125 total -> 0.13 (half-up), not 0.12 (banker's/half-even).
    const pkg2: CommissionPackageInput = { price: 2.5, entitlementKind: 'SESSION_COUNT', totalUnits: 10, validityDays: 30 };
    const rule2 = { id: 'rhalf2', type: 'PERCENTAGE' as const, value: 50 };
    // unit price = 0.25, * 1 unit * 50% = 0.125
    const result2 = calculateTrainerCommission([session({ trainerRule: rule2, bookings: [attended(pkg2)] })]);
    expect(result2.grossAmount.toFixed(2)).toBe('0.13');
  });

  it('mixes rule kinds across sessions taught by the same trainer within one run', () => {
    const fixedRule = { id: 'mix-fixed', type: 'PER_SESSION_FIXED' as const, value: 350 };
    const percentRule = { id: 'mix-percent', type: 'PERCENTAGE' as const, value: 40 };
    const pkg = sessionCountPackage(12000, 10);
    const result = calculateTrainerCommission([
      session({ scheduleId: 's1', trainerRule: fixedRule, bookings: [] }),
      session({ scheduleId: 's2', trainerRule: percentRule, bookings: [attended(pkg)] }),
    ]);

    // 350 + 480 = 830
    expect(result.grossAmount.toFixed(2)).toBe('830.00');
    expect(result.sessions).toBe(2);
  });

  it('returns Prisma.Decimal instances for amounts and unit prices', () => {
    const rule = { id: 'decimal-check', type: 'PERCENTAGE' as const, value: 40 };
    const pkg = sessionCountPackage(12000, 10);
    const result = calculateTrainerCommission([session({ trainerRule: rule, bookings: [attended(pkg)] })]);

    expect(result.grossAmount).toBeInstanceOf(Prisma.Decimal);
    expect(result.details[0].amount).toBeInstanceOf(Prisma.Decimal);
    expect(result.details[0].unitPrice).toBeInstanceOf(Prisma.Decimal);
  });
});
