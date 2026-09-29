import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { LoyaltyLedger, LoyaltyRedemption, LoyaltyReward, LoyaltyRule, PromoCode } from '@platform/database';
import { LoyaltyRuleConditionsSchema, validateLoyaltyReward } from '@platform/shared';
import type {
  CreateLoyaltyRewardInput,
  CreateLoyaltyRuleInput,
  LoyaltyAdjustInput,
  LoyaltyBalanceDTO,
  LoyaltyLedgerEntryDTO,
  LoyaltyLedgerPageDTO,
  LoyaltyLedgerQuery,
  LoyaltyMemberSummaryDTO,
  LoyaltyReason,
  LoyaltyRedeemInput,
  LoyaltyRedeemResultDTO,
  LoyaltyRedemptionDTO,
  LoyaltyRewardDTO,
  LoyaltyRewardType,
  LoyaltyRuleDTO,
  LoyaltyRuleKind,
  LoyaltySettingsDTO,
  LoyaltySourceType,
  UpdateLoyaltyRewardInput,
  UpdateLoyaltyRuleInput,
  UpdateLoyaltySettingsInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { PromotionsService } from '../promotions/promotions.service';
import { creditActivePackageUnits } from '../members/package-credit';
import { LoyaltyLedgerService } from './loyalty-ledger.service';
import { loyaltyError } from './loyalty.errors';

const DAY_MS = 24 * 60 * 60 * 1000;
const SUMMARY_LEDGER_ROWS = 20;
const SUMMARY_REDEMPTIONS = 10;

type LedgerRow = LoyaltyLedger & { createdBy: { user: { firstName: string; lastName: string } } | null };
type RedemptionRow = LoyaltyRedemption & { promoCode: PromoCode | null };

interface MemberRef {
  membershipId: string;
  userId: string;
  memberProfileId: string;
}

export function toRuleDto(rule: LoyaltyRule): LoyaltyRuleDTO {
  const conditions = LoyaltyRuleConditionsSchema.safeParse(rule.conditions ?? {});
  return {
    id: rule.id,
    kind: rule.kind as LoyaltyRuleKind,
    name: rule.name,
    points: rule.points,
    perAmount: rule.perAmount ? rule.perAmount.toFixed(2) : null,
    currency: rule.currency,
    conditions: conditions.success ? conditions.data : {},
    isActive: rule.isActive,
    createdAt: rule.createdAt.toISOString(),
  };
}

export function toRewardDto(reward: LoyaltyReward): LoyaltyRewardDTO {
  return {
    id: reward.id,
    name: reward.name,
    description: reward.description,
    type: reward.type as LoyaltyRewardType,
    costPoints: reward.costPoints,
    value: reward.value ? reward.value.toFixed(2) : null,
    currency: reward.currency,
    validityDays: reward.validityDays,
    isActive: reward.isActive,
    memberRedeemable: reward.memberRedeemable,
    createdAt: reward.createdAt.toISOString(),
  };
}

function toLedgerDto(row: LedgerRow): LoyaltyLedgerEntryDTO {
  return {
    id: row.id,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    reason: row.reason as LoyaltyReason,
    sourceType: row.sourceType as LoyaltySourceType,
    note: row.note,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy ? `${row.createdBy.user.firstName} ${row.createdBy.user.lastName}`.trim() : null,
  };
}

function toRedemptionDto(row: RedemptionRow): LoyaltyRedemptionDTO {
  return {
    id: row.id,
    rewardName: row.rewardName,
    type: row.type as LoyaltyRewardType,
    pointsSpent: row.pointsSpent,
    value: row.value ? row.value.toFixed(2) : null,
    currency: row.currency,
    promoCode: row.promoCode?.code ?? null,
    promoCodeValidTo: row.promoCode?.validTo?.toISOString() ?? null,
    memberPackageId: row.memberPackageId,
    createdAt: row.createdAt.toISOString(),
  };
}

const LEDGER_INCLUDE = { createdBy: { select: { user: { select: { firstName: true, lastName: true } } } } } as const;

/**
 * Loyalty program administration and the member-facing views (G3a,
 * docs/SADAKAT.md): settings, earn rules, rewards, balances and history,
 * manual adjustments and redemptions. Every query is scoped by the tenant's
 * studio; ledger writes go through LoyaltyLedgerService only.
 */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LoyaltyLedgerService,
    private readonly promotions: PromotionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  private async studioCurrency(studioId: string): Promise<string> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { currency: true } });
    return studio.currency;
  }

  async getSettings(studioId: string): Promise<LoyaltySettingsDTO> {
    const [settings, currency] = await Promise.all([this.ledger.settings(studioId), this.studioCurrency(studioId)]);
    return { ...settings, currency };
  }

  async updateSettings(tenant: TenantContext, actorUserId: string, input: UpdateLoyaltySettingsInput): Promise<LoyaltySettingsDTO> {
    const current = await this.ledger.settings(tenant.studioId);
    const next = {
      enabled: input.enabled ?? current.enabled,
      expiryMode: input.expiryMode ?? current.expiryMode,
      expiryMonths: input.expiryMonths !== undefined ? input.expiryMonths : current.expiryMonths,
      expiryNoticeDays: input.expiryNoticeDays ?? current.expiryNoticeDays,
      memberRedeemEnabled: input.memberRedeemEnabled ?? current.memberRedeemEnabled,
    };
    if (next.expiryMode === 'MONTHS_AFTER_EARN' && !next.expiryMonths) next.expiryMonths = 12;
    if (next.expiryMode === 'NONE') next.expiryMonths = null;
    await this.prisma.loyaltySettings.upsert({ where: { studioId: tenant.studioId }, create: { studioId: tenant.studioId, ...next }, update: next });
    await this.prisma.auditLog.create({
      data: { studioId: tenant.studioId, userId: actorUserId, action: 'loyalty.settings.update', entityType: 'LoyaltySettings', entityId: tenant.studioId, metadata: next },
    });
    return this.getSettings(tenant.studioId);
  }

  // ---------------------------------------------------------------------------
  // Earn rules
  // ---------------------------------------------------------------------------

  async listRules(studioId: string): Promise<LoyaltyRuleDTO[]> {
    const rows = await this.prisma.loyaltyRule.findMany({ where: { studioId }, orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toRuleDto);
  }

  private async assertRuleCurrency(studioId: string, currency: string | null | undefined): Promise<void> {
    if (currency == null) return;
    if (currency !== (await this.studioCurrency(studioId))) throw loyaltyError('LOYALTY_CURRENCY_MISMATCH');
  }

  async createRule(studioId: string, input: CreateLoyaltyRuleInput): Promise<LoyaltyRuleDTO> {
    const purchase = input.kind === 'PURCHASE_AMOUNT';
    if (purchase) await this.assertRuleCurrency(studioId, input.currency);
    const row = await this.prisma.loyaltyRule.create({
      data: {
        studioId,
        kind: input.kind,
        name: input.name,
        points: input.points,
        perAmount: purchase && input.perAmount != null ? new Prisma.Decimal(input.perAmount) : null,
        currency: purchase ? (input.currency ?? null) : null,
        conditions: input.conditions as Prisma.InputJsonValue,
        isActive: input.isActive,
      },
    });
    return toRuleDto(row);
  }

  async updateRule(studioId: string, ruleId: string, input: UpdateLoyaltyRuleInput): Promise<LoyaltyRuleDTO> {
    const existing = await this.prisma.loyaltyRule.findFirst({ where: { id: ruleId, studioId } });
    if (!existing) throw new NotFoundException('Kural bulunamadı');
    const purchase = existing.kind === 'PURCHASE_AMOUNT';
    if (purchase && input.currency !== undefined) await this.assertRuleCurrency(studioId, input.currency);
    const row = await this.prisma.loyaltyRule.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        points: input.points,
        ...(purchase && input.perAmount != null ? { perAmount: new Prisma.Decimal(input.perAmount) } : {}),
        ...(purchase && input.currency != null ? { currency: input.currency } : {}),
        ...(input.conditions ? { conditions: input.conditions as Prisma.InputJsonValue } : {}),
        isActive: input.isActive,
      },
    });
    return toRuleDto(row);
  }

  /** Ledger rows keep the rule id as plain data, so a rule can always be removed. */
  async deleteRule(studioId: string, ruleId: string): Promise<void> {
    const deleted = await this.prisma.loyaltyRule.deleteMany({ where: { id: ruleId, studioId } });
    if (deleted.count === 0) throw new NotFoundException('Kural bulunamadı');
  }

  // ---------------------------------------------------------------------------
  // Rewards
  // ---------------------------------------------------------------------------

  async listRewards(studioId: string): Promise<LoyaltyRewardDTO[]> {
    const rows = await this.prisma.loyaltyReward.findMany({ where: { studioId }, orderBy: [{ costPoints: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toRewardDto);
  }

  async createReward(studioId: string, input: CreateLoyaltyRewardInput): Promise<LoyaltyRewardDTO> {
    const monetary = input.type === 'DISCOUNT_AMOUNT';
    if (monetary) await this.assertRuleCurrency(studioId, input.currency);
    const row = await this.prisma.loyaltyReward.create({
      data: {
        studioId,
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        costPoints: input.costPoints,
        value: input.type === 'GIFT' || input.value == null ? null : new Prisma.Decimal(input.value),
        currency: monetary ? (input.currency ?? null) : null,
        validityDays: input.validityDays,
        isActive: input.isActive,
        memberRedeemable: input.memberRedeemable,
      },
    });
    return toRewardDto(row);
  }

  async updateReward(studioId: string, rewardId: string, input: UpdateLoyaltyRewardInput): Promise<LoyaltyRewardDTO> {
    const existing = await this.prisma.loyaltyReward.findFirst({ where: { id: rewardId, studioId } });
    if (!existing) throw new NotFoundException('Ödül bulunamadı');
    const type = existing.type as LoyaltyRewardType;
    const monetary = type === 'DISCOUNT_AMOUNT';
    const value = input.value !== undefined ? input.value : existing.value ? Number(existing.value) : null;
    const currency = monetary ? (input.currency !== undefined ? input.currency : existing.currency) : null;
    const issue = validateLoyaltyReward({ type, value, currency });
    if (issue) throw new BadRequestException({ message: 'Geçersiz istek', errors: [{ path: 'value', message: issue }] });
    if (monetary) await this.assertRuleCurrency(studioId, currency);
    const row = await this.prisma.loyaltyReward.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        description: input.description,
        costPoints: input.costPoints,
        value: type === 'GIFT' || value == null ? null : new Prisma.Decimal(value),
        currency,
        validityDays: input.validityDays,
        isActive: input.isActive,
        memberRedeemable: input.memberRedeemable,
      },
    });
    return toRewardDto(row);
  }

  /** A reward that was ever redeemed is kept (history names it) and only deactivated. */
  async deleteReward(studioId: string, rewardId: string): Promise<{ deleted: boolean; deactivated: boolean }> {
    const existing = await this.prisma.loyaltyReward.findFirst({ where: { id: rewardId, studioId }, include: { _count: { select: { redemptions: true } } } });
    if (!existing) throw new NotFoundException('Ödül bulunamadı');
    if (existing._count.redemptions > 0) {
      await this.prisma.loyaltyReward.update({ where: { id: existing.id }, data: { isActive: false } });
      return { deleted: false, deactivated: true };
    }
    await this.prisma.loyaltyReward.delete({ where: { id: existing.id } });
    return { deleted: true, deactivated: false };
  }

  // ---------------------------------------------------------------------------
  // Balances and history
  // ---------------------------------------------------------------------------

  private async memberRef(studioId: string, memberProfileId: string): Promise<MemberRef> {
    const member = await this.prisma.memberProfile.findFirst({
      where: { id: memberProfileId, studioId },
      select: { id: true, membershipId: true, membership: { select: { userId: true } } },
    });
    if (!member) throw new NotFoundException('Üye bulunamadı');
    return { membershipId: member.membershipId, userId: member.membership.userId, memberProfileId: member.id };
  }

  private async selfRef(tenant: TenantContext): Promise<MemberRef> {
    if (!tenant.memberProfileId) throw new NotFoundException('Üye profili bulunamadı');
    return this.memberRef(tenant.studioId, tenant.memberProfileId);
  }

  private async balance(studioId: string, membershipId: string, enabled: boolean, now = new Date()): Promise<LoyaltyBalanceDTO> {
    const account = await this.prisma.loyaltyAccount.findFirst({ where: { studioId, membershipId } });
    let nextExpiry: LoyaltyBalanceDTO['nextExpiry'] = null;
    if (account && account.balance > 0 && account.nextExpiryAt) {
      const { remaining } = await this.ledger.lots(studioId, membershipId);
      const upcoming = remaining
        .filter((l) => l.remaining > 0 && l.expiresAt && l.expiresAt.getTime() > now.getTime())
        .sort((a, b) => (a.expiresAt as Date).getTime() - (b.expiresAt as Date).getTime());
      if (upcoming.length) {
        const first = (upcoming[0].expiresAt as Date).getTime();
        const points = upcoming.filter((l) => (l.expiresAt as Date).getTime() === first).reduce((s, l) => s + l.remaining, 0);
        nextExpiry = { points, expiresAt: new Date(first).toISOString() };
      }
    }
    return {
      enabled,
      balance: account?.balance ?? 0,
      lifetimeEarned: account?.lifetimeEarned ?? 0,
      lifetimeRedeemed: account?.lifetimeRedeemed ?? 0,
      nextExpiry,
    };
  }

  private async summary(studioId: string, ref: MemberRef, audience: 'staff' | 'member'): Promise<LoyaltyMemberSummaryDTO> {
    const settings = await this.ledger.settings(studioId);
    const balance = await this.balance(studioId, ref.membershipId, settings.enabled);
    const [ledgerRows, redemptions, rewards, presets] = await Promise.all([
      this.prisma.loyaltyLedger.findMany({
        where: { studioId, membershipId: ref.membershipId },
        include: LEDGER_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SUMMARY_LEDGER_ROWS,
      }),
      this.prisma.loyaltyRedemption.findMany({
        where: { studioId, membershipId: ref.membershipId },
        include: { promoCode: true },
        orderBy: { createdAt: 'desc' },
        take: SUMMARY_REDEMPTIONS,
      }),
      this.prisma.loyaltyReward.findMany({
        where: { studioId, isActive: true, ...(audience === 'member' ? { memberRedeemable: true } : {}) },
        orderBy: [{ costPoints: 'asc' }, { createdAt: 'asc' }],
      }),
      audience === 'staff'
        ? this.prisma.loyaltyRule.findMany({ where: { studioId, kind: 'MANUAL', isActive: true }, orderBy: { createdAt: 'asc' } })
        : Promise.resolve([] as LoyaltyRule[]),
    ]);
    return {
      ...balance,
      membershipId: ref.membershipId,
      ledger: ledgerRows.map(toLedgerDto),
      redemptions: redemptions.map(toRedemptionDto),
      rewards: rewards.map((r) => ({ ...toRewardDto(r), affordable: balance.balance >= r.costPoints })),
      presets: presets.map(toRuleDto),
      memberRedeemEnabled: settings.enabled && settings.memberRedeemEnabled,
    };
  }

  async memberSummary(studioId: string, memberProfileId: string): Promise<LoyaltyMemberSummaryDTO> {
    return this.summary(studioId, await this.memberRef(studioId, memberProfileId), 'staff');
  }

  async mySummary(tenant: TenantContext): Promise<LoyaltyMemberSummaryDTO> {
    return this.summary(tenant.studioId, await this.selfRef(tenant), 'member');
  }

  private async ledgerPage(studioId: string, membershipId: string, query: LoyaltyLedgerQuery): Promise<LoyaltyLedgerPageDTO> {
    const where = { studioId, membershipId };
    const [rows, total] = await Promise.all([
      this.prisma.loyaltyLedger.findMany({
        where,
        include: LEDGER_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.loyaltyLedger.count({ where }),
    ]);
    return { items: rows.map(toLedgerDto), total, page: query.page, limit: query.limit };
  }

  async memberLedger(studioId: string, memberProfileId: string, query: LoyaltyLedgerQuery): Promise<LoyaltyLedgerPageDTO> {
    const ref = await this.memberRef(studioId, memberProfileId);
    return this.ledgerPage(studioId, ref.membershipId, query);
  }

  async myLedger(tenant: TenantContext, query: LoyaltyLedgerQuery): Promise<LoyaltyLedgerPageDTO> {
    const ref = await this.selfRef(tenant);
    return this.ledgerPage(tenant.studioId, ref.membershipId, query);
  }

  /** The contact card balance line; a contact without a membership has no account. */
  async contactBalance(studioId: string, contactId: string): Promise<LoyaltyBalanceDTO & { membershipId: string | null }> {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, studioId }, select: { membershipId: true } });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    const settings = await this.ledger.settings(studioId);
    if (!contact.membershipId) {
      return { enabled: settings.enabled, balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0, nextExpiry: null, membershipId: null };
    }
    return { ...(await this.balance(studioId, contact.membershipId, settings.enabled)), membershipId: contact.membershipId };
  }

  // ---------------------------------------------------------------------------
  // Manual adjustment
  // ---------------------------------------------------------------------------

  async adjust(tenant: TenantContext, actorUserId: string, memberProfileId: string, input: LoyaltyAdjustInput): Promise<LoyaltyMemberSummaryDTO> {
    const ref = await this.memberRef(tenant.studioId, memberProfileId);
    const settings = await this.ledger.settings(tenant.studioId);
    if (!settings.enabled) throw loyaltyError('LOYALTY_DISABLED');
    if (input.ruleId) {
      const preset = await this.prisma.loyaltyRule.findFirst({ where: { id: input.ruleId, studioId: tenant.studioId, kind: 'MANUAL' } });
      if (!preset) throw new NotFoundException('Kural bulunamadı');
    }
    const result = await this.ledger.post({
      studioId: tenant.studioId,
      membershipId: ref.membershipId,
      delta: input.points,
      reason: 'MANUAL_ADJUST',
      sourceType: 'manual',
      sourceId: input.idempotencyKey ? `${ref.membershipId}:${input.idempotencyKey}` : randomUUID(),
      ruleId: input.ruleId ?? null,
      note: input.note,
      createdByMembershipId: tenant.membershipId,
    });
    if (!result.duplicate) {
      await this.prisma.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'loyalty.adjust',
          entityType: 'LoyaltyLedger',
          entityId: result.entry.id,
          metadata: { membershipId: ref.membershipId, points: input.points, note: input.note },
        },
      });
    }
    return this.memberSummary(tenant.studioId, memberProfileId);
  }

  // ---------------------------------------------------------------------------
  // Redemption
  // ---------------------------------------------------------------------------

  async redeemForMember(tenant: TenantContext, actorUserId: string, memberProfileId: string, input: LoyaltyRedeemInput): Promise<LoyaltyRedeemResultDTO> {
    const ref = await this.memberRef(tenant.studioId, memberProfileId);
    return this.redeem(tenant.studioId, ref, input, { actorUserId, actorMembershipId: tenant.membershipId, self: false });
  }

  async redeemSelf(tenant: TenantContext, actorUserId: string, input: LoyaltyRedeemInput): Promise<LoyaltyRedeemResultDTO> {
    const ref = await this.selfRef(tenant);
    return this.redeem(tenant.studioId, ref, input, { actorUserId, actorMembershipId: tenant.membershipId, self: true });
  }

  /**
   * One transaction: the negative REDEEM row (409 when the balance is too
   * low, serialised by the account lock) and the effect, reusing the
   * existing services: a single-use promotion code only this member can
   * use (PromotionsService), or units on the member's active package (the
   * same helper as the referral reward). If the effect fails, the debit is
   * rolled back with it. A retried request with the same idempotency key
   * returns the first redemption.
   */
  private async redeem(
    studioId: string,
    ref: MemberRef,
    input: LoyaltyRedeemInput,
    actor: { actorUserId: string; actorMembershipId: string | null; self: boolean },
  ): Promise<LoyaltyRedeemResultDTO> {
    const settings = await this.ledger.settings(studioId);
    if (!settings.enabled) throw loyaltyError('LOYALTY_DISABLED');
    if (actor.self && !settings.memberRedeemEnabled) throw loyaltyError('LOYALTY_MEMBER_REDEEM_DISABLED');
    const reward = await this.prisma.loyaltyReward.findFirst({ where: { id: input.rewardId, studioId } });
    if (!reward) throw new NotFoundException('Ödül bulunamadı');
    if (!reward.isActive) throw loyaltyError('LOYALTY_REWARD_INACTIVE');
    if (actor.self && !reward.memberRedeemable) throw loyaltyError('LOYALTY_MEMBER_REDEEM_DISABLED');
    const type = reward.type as LoyaltyRewardType;
    if (type === 'DISCOUNT_AMOUNT' && reward.currency !== (await this.studioCurrency(studioId))) throw loyaltyError('LOYALTY_CURRENCY_MISMATCH');

    const redemptionId = randomUUID();
    const sourceId = input.idempotencyKey ? `${ref.membershipId}:${input.idempotencyKey}` : redemptionId;
    const now = new Date();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const debit = await this.ledger.postTx(tx, {
        studioId,
        membershipId: ref.membershipId,
        delta: -reward.costPoints,
        reason: 'REDEEM',
        sourceType: 'redemption',
        sourceId,
        note: reward.name,
        createdByMembershipId: actor.actorMembershipId,
        now,
      });
      if (debit.duplicate) {
        const existing = await tx.loyaltyRedemption.findUnique({ where: { ledgerId: debit.entry.id }, include: { promoCode: true } });
        if (!existing) throw new NotFoundException('Ödül kullanımı bulunamadı');
        return { redemption: existing, balance: debit.balance, duplicate: true };
      }

      let promoCodeId: string | null = null;
      let memberPackageId: string | null = null;
      const value = reward.value ?? new Prisma.Decimal(0);
      if (type === 'DISCOUNT_AMOUNT' || type === 'DISCOUNT_PERCENT') {
        const promo = await this.promotions.issueLoyaltyPromoCodeTx(tx, {
          studioId,
          createdByUserId: actor.actorUserId,
          restrictedToUserId: ref.userId,
          kind: type === 'DISCOUNT_PERCENT' ? 'PERCENT' : 'FIXED_AMOUNT',
          value,
          validTo: new Date(now.getTime() + reward.validityDays * DAY_MS),
        });
        promoCodeId = promo.id;
      } else if (type === 'EXTRA_SESSION_CREDIT') {
        const credited = await creditActivePackageUnits(tx, studioId, ref.memberProfileId, Math.round(Number(value)));
        if (!credited) throw loyaltyError('LOYALTY_NO_ACTIVE_PACKAGE');
        memberPackageId = credited.id;
      }

      const redemption = await tx.loyaltyRedemption.create({
        data: {
          id: redemptionId,
          studioId,
          membershipId: ref.membershipId,
          rewardId: reward.id,
          ledgerId: debit.entry.id,
          rewardName: reward.name,
          type,
          pointsSpent: reward.costPoints,
          value: reward.value,
          currency: reward.currency,
          promoCodeId,
          memberPackageId,
          createdByMembershipId: actor.actorMembershipId,
          createdAt: now,
        },
        include: { promoCode: true },
      });
      await tx.auditLog.create({
        data: {
          studioId,
          userId: actor.actorUserId,
          action: actor.self ? 'loyalty.redeem.self' : 'loyalty.redeem',
          entityType: 'LoyaltyRedemption',
          entityId: redemption.id,
          metadata: { membershipId: ref.membershipId, rewardId: reward.id, points: reward.costPoints },
        },
      });
      return { redemption, balance: debit.balance, duplicate: false };
    });

    return { redemption: toRedemptionDto(outcome.redemption), balance: outcome.balance, duplicate: outcome.duplicate };
  }
}
