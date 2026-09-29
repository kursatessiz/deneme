import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { LoyaltyRule } from '@platform/database';
import { LoyaltyRuleConditionsSchema, purchaseAmountPoints } from '@platform/shared';
import type { LoyaltyReason, LoyaltyRuleConditions, LoyaltyRuleKind, LoyaltySourceType } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyLedgerService } from './loyalty-ledger.service';

type Tx = Prisma.TransactionClient;

export type JourneyAwardOutcome =
  | { status: 'DONE'; duplicate: boolean; points: number }
  | { status: 'SKIPPED'; reasonCode: 'LOYALTY_DISABLED' | 'NO_MEMBERSHIP' };

function conditionsOf(rule: Pick<LoyaltyRule, 'conditions'>): LoyaltyRuleConditions {
  const parsed = LoyaltyRuleConditionsSchema.safeParse(rule.conditions ?? {});
  return parsed.success ? parsed.data : {};
}

/** True when the rule has no list for this condition, or the list contains the value. */
function allows(list: string[] | undefined, value: string | null | undefined): boolean {
  if (!list || list.length === 0) return true;
  return value != null && list.includes(value);
}

/**
 * Earning sources (docs/SADAKAT.md "Kazanma"). Each source is keyed by its
 * business record (booking, payment, referral, member badge, birthday year,
 * journey enrollment step), so a retried hook, a second check-in path or a
 * concurrent heartbeat never credits twice. All matching active rules of a
 * kind are summed into one ledger row per record. Hooks called from
 * business flows never throw: a loyalty failure must not fail a check-in,
 * a payment or a badge.
 */
@Injectable()
export class LoyaltyEarnService {
  private readonly logger = new Logger(LoyaltyEarnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LoyaltyLedgerService,
  ) {}

  private async activeRules(client: Tx | PrismaService, studioId: string, kind: LoyaltyRuleKind): Promise<LoyaltyRule[] | null> {
    const settings = await this.ledger.settings(studioId, client);
    if (!settings.enabled) return null;
    const rules = await client.loyaltyRule.findMany({ where: { studioId, kind, isActive: true }, orderBy: { createdAt: 'asc' } });
    return rules.length ? rules : null;
  }

  private async credit(
    client: Tx | null,
    input: { studioId: string; membershipId: string; points: number; reason: LoyaltyReason; sourceType: LoyaltySourceType; sourceId: string; rules: LoyaltyRule[] },
  ): Promise<number> {
    if (input.points <= 0) return 0;
    const entry = {
      studioId: input.studioId,
      membershipId: input.membershipId,
      delta: input.points,
      reason: input.reason,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ruleId: input.rules[0]?.id ?? null,
      note: input.rules.map((r) => r.name).join(', ').slice(0, 300) || null,
    };
    const result = client ? await this.ledger.postTx(client, entry) : await this.ledger.post(entry);
    return result.duplicate ? 0 : input.points;
  }

  private async safely(what: string, fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`Loyalty earn failed (${what}): ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }

  /** A booking was checked in (staff, QR or kiosk; called once per path through CrmHooksService). */
  async onAttendance(studioId: string, bookingId: string): Promise<number> {
    return this.safely(`attendance ${bookingId}`, async () => {
      const rules = await this.activeRules(this.prisma, studioId, 'ATTENDANCE');
      if (!rules) return 0;
      const booking = await this.prisma.booking.findFirst({
        where: { id: bookingId, studioId, status: 'ATTENDED' },
        select: {
          schedule: { select: { serviceTypeId: true } },
          member: { select: { membershipId: true, membership: { select: { isPartnerGuest: true } } } },
        },
      });
      if (!booking || booking.member.membership.isPartnerGuest) return 0;
      const matched = rules.filter((r) => allows(conditionsOf(r).serviceTypeIds, booking.schedule.serviceTypeId));
      const points = matched.reduce((sum, r) => sum + r.points, 0);
      return this.credit(null, {
        studioId,
        membershipId: booking.member.membershipId,
        points,
        reason: 'EARN_ATTENDANCE',
        sourceType: 'booking',
        sourceId: bookingId,
        rules: matched,
      });
    });
  }

  /**
   * A payment reached COMPLETED. PURCHASE_AMOUNT rules give points per
   * whole unit of the net paid amount in the rule's currency (rule 8: a
   * payment in another currency earns nothing under that rule).
   */
  async onPayment(studioId: string, paymentId: string): Promise<number> {
    return this.safely(`payment ${paymentId}`, async () => {
      const rules = await this.activeRules(this.prisma, studioId, 'PURCHASE_AMOUNT');
      if (!rules) return 0;
      const payment = await this.prisma.payment.findFirst({
        where: { id: paymentId, studioId, paymentStatus: 'COMPLETED' },
        select: {
          amount: true,
          refundedAmount: true,
          currency: true,
          memberPackage: { select: { packageDefinitionId: true } },
          member: { select: { membershipId: true, membership: { select: { isPartnerGuest: true } } } },
        },
      });
      if (!payment || payment.member.membership.isPartnerGuest) return 0;
      const net = Number(payment.amount.minus(payment.refundedAmount));
      const packageDefinitionId = payment.memberPackage?.packageDefinitionId ?? null;
      const matched: LoyaltyRule[] = [];
      let points = 0;
      for (const rule of rules) {
        if (!allows(conditionsOf(rule).packageDefinitionIds, packageDefinitionId)) continue;
        const earned = purchaseAmountPoints(
          { amount: net, currency: payment.currency },
          { points: rule.points, perAmount: rule.perAmount ? Number(rule.perAmount) : null, currency: rule.currency },
        );
        if (earned > 0) {
          matched.push(rule);
          points += earned;
        }
      }
      return this.credit(null, {
        studioId,
        membershipId: payment.member.membershipId,
        points,
        reason: 'EARN_PURCHASE',
        sourceType: 'payment',
        sourceId: paymentId,
        rules: matched,
      });
    });
  }

  /**
   * The referral module moved a referral to REWARDED (inside its own
   * transaction, exactly once). REFERRAL rules credit the referrer; the
   * package-unit reward of W15 is separate and stays a tenant setting.
   * Errors propagate: the referral transaction decides.
   */
  async onReferralRewardedTx(tx: Tx, studioId: string, referralId: string, referrerMemberProfileId: string): Promise<number> {
    const rules = await this.activeRules(tx, studioId, 'REFERRAL');
    if (!rules) return 0;
    const referrer = await tx.memberProfile.findFirst({ where: { id: referrerMemberProfileId, studioId }, select: { membershipId: true } });
    if (!referrer) return 0;
    return this.credit(tx, {
      studioId,
      membershipId: referrer.membershipId,
      points: rules.reduce((sum, r) => sum + r.points, 0),
      reason: 'EARN_REFERRAL',
      sourceType: 'referral',
      sourceId: referralId,
      rules,
    });
  }

  /** The gamification module awarded a badge (one member_badges row, unique per member and badge). */
  async onBadgeAwarded(studioId: string, memberProfileId: string, memberBadgeId: string, badgeDefinitionId: string): Promise<number> {
    return this.safely(`badge ${memberBadgeId}`, async () => {
      const rules = await this.activeRules(this.prisma, studioId, 'BADGE');
      if (!rules) return 0;
      const member = await this.prisma.memberProfile.findFirst({
        where: { id: memberProfileId, studioId },
        select: { membershipId: true, membership: { select: { isPartnerGuest: true } } },
      });
      if (!member || member.membership.isPartnerGuest) return 0;
      const matched = rules.filter((r) => allows(conditionsOf(r).badgeDefinitionIds, badgeDefinitionId));
      return this.credit(null, {
        studioId,
        membershipId: member.membershipId,
        points: matched.reduce((sum, r) => sum + r.points, 0),
        reason: 'EARN_BADGE',
        sourceType: 'badge',
        sourceId: memberBadgeId,
        rules: matched,
      });
    });
  }

  /**
   * Journey `award_points` step: idempotent per enrollment and step. A
   * contact without a membership in this studio (a lead) has no account.
   */
  async awardFromJourney(input: { studioId: string; contactId: string; enrollmentId: string; stepId: string; points: number; reasonKey: string }): Promise<JourneyAwardOutcome> {
    const settings = await this.ledger.settings(input.studioId);
    if (!settings.enabled) return { status: 'SKIPPED', reasonCode: 'LOYALTY_DISABLED' };
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, studioId: input.studioId },
      select: { membershipId: true, membership: { select: { studioId: true } } },
    });
    if (!contact?.membershipId || contact.membership?.studioId !== input.studioId) return { status: 'SKIPPED', reasonCode: 'NO_MEMBERSHIP' };
    const result = await this.ledger.post({
      studioId: input.studioId,
      membershipId: contact.membershipId,
      delta: input.points,
      reason: 'JOURNEY_AWARD',
      sourceType: 'journey',
      sourceId: `${input.enrollmentId}:${input.stepId}`,
      note: input.reasonKey,
    });
    return { status: 'DONE', duplicate: result.duplicate, points: input.points };
  }

  /**
   * Heartbeat: BIRTHDAY rules credit members whose birthday is today in the
   * studio's time zone (29 February counts on 28 February in other years),
   * once per member and year.
   */
  async awardBirthdays(now: Date): Promise<number> {
    const studios = await this.prisma.loyaltySettings.findMany({
      where: { enabled: true, studio: { isActive: true, loyaltyRules: { some: { kind: 'BIRTHDAY', isActive: true } } } },
      select: { studioId: true, studio: { select: { timezone: true } } },
    });
    let awarded = 0;
    for (const { studioId, studio } of studios) {
      const rules = await this.activeRules(this.prisma, studioId, 'BIRTHDAY');
      if (!rules) continue;
      const today = localDate(now, studio.timezone);
      const members = await this.prisma.memberProfile.findMany({
        where: { studioId, birthDate: { not: null }, membership: { status: 'ACTIVE', isPartnerGuest: false } },
        select: { membershipId: true, birthDate: true },
      });
      for (const m of members) {
        if (!m.birthDate || !isBirthday(m.birthDate, today)) continue;
        awarded += await this.safely(`birthday ${m.membershipId}`, () =>
          this.credit(null, {
            studioId,
            membershipId: m.membershipId,
            points: rules.reduce((sum, r) => sum + r.points, 0),
            reason: 'EARN_BIRTHDAY',
            sourceType: 'birthday',
            sourceId: `${m.membershipId}:${today.year}`,
            rules,
          }),
        );
      }
    }
    return awarded;
  }
}

function localDate(now: Date, timeZone: string): { year: number; month: number; day: number } {
  let zone = timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(now);
  } catch {
    zone = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** A birth date (stored as a calendar date) falls on `today`; 29 February moves to 28 February in common years. */
export function isBirthday(birthDate: Date, today: { year: number; month: number; day: number }): boolean {
  const month = birthDate.getUTCMonth() + 1;
  const day = birthDate.getUTCDate();
  if (month === today.month && day === today.day) return true;
  const leap = (today.year % 4 === 0 && today.year % 100 !== 0) || today.year % 400 === 0;
  return month === 2 && day === 29 && !leap && today.month === 2 && today.day === 28;
}
