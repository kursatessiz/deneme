import { z } from 'zod';

/**
 * Loyalty points (G3a, docs/SADAKAT.md). The ledger is append-only: every
 * earn, spend, manual adjustment and expiry is one row with a signed delta
 * and the balance after it. Earn rules and the rewards catalogue are tenant
 * data (CLAUDE.md rule 7); the kinds and types below only name what the API
 * knows how to evaluate or fulfil.
 */

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

/** What an earn rule listens to. MANUAL rules are presets staff pick on the member card. */
export const LOYALTY_RULE_KINDS = ['ATTENDANCE', 'PURCHASE_AMOUNT', 'REFERRAL', 'BIRTHDAY', 'BADGE', 'MANUAL'] as const;
export type LoyaltyRuleKind = (typeof LOYALTY_RULE_KINDS)[number];

/** Why a ledger row exists. Stored as a string key; the UI translates `loyalty.reason.<key>`. */
export const LOYALTY_REASONS = [
  'EARN_ATTENDANCE',
  'EARN_PURCHASE',
  'EARN_REFERRAL',
  'EARN_BIRTHDAY',
  'EARN_BADGE',
  'MANUAL_ADJUST',
  'JOURNEY_AWARD',
  'REDEEM',
  'EXPIRED',
] as const;
export type LoyaltyReason = (typeof LOYALTY_REASONS)[number];

/** The business record behind a ledger row; (studio, sourceType, sourceId, reason) is unique. */
export const LOYALTY_SOURCE_TYPES = ['booking', 'payment', 'referral', 'birthday', 'badge', 'manual', 'journey', 'redemption', 'lot'] as const;
export type LoyaltySourceType = (typeof LOYALTY_SOURCE_TYPES)[number];

export const LOYALTY_REWARD_TYPES = ['DISCOUNT_AMOUNT', 'DISCOUNT_PERCENT', 'EXTRA_SESSION_CREDIT', 'GIFT'] as const;
export type LoyaltyRewardType = (typeof LOYALTY_REWARD_TYPES)[number];

export const LOYALTY_EXPIRY_MODES = ['NONE', 'MONTHS_AFTER_EARN'] as const;
export type LoyaltyExpiryMode = (typeof LOYALTY_EXPIRY_MODES)[number];

/** Stable error codes the API sends in the body (`code`); the UI translates `loyalty.error.<code>`. */
export const LOYALTY_ERROR_CODES = [
  'LOYALTY_DISABLED',
  'LOYALTY_INSUFFICIENT_BALANCE',
  'LOYALTY_REWARD_INACTIVE',
  'LOYALTY_MEMBER_REDEEM_DISABLED',
  'LOYALTY_NO_ACTIVE_PACKAGE',
  'LOYALTY_CURRENCY_MISMATCH',
] as const;
export type LoyaltyErrorCode = (typeof LOYALTY_ERROR_CODES)[number];

/** Template the expiry notice uses (built-in tr/en defaults in message-templates.ts). */
export const LOYALTY_EXPIRY_TEMPLATE_KEY = 'LOYALTY_POINTS_EXPIRING';

export const LOYALTY_MAX_POINTS = 1_000_000;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const UpdateLoyaltySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    expiryMode: z.enum(LOYALTY_EXPIRY_MODES).optional(),
    /** MONTHS_AFTER_EARN: how long an earned lot stays spendable. */
    expiryMonths: z.number().int().min(1).max(120).nullable().optional(),
    /** Days before a lot expires that the member is told; 0 = no notice. */
    expiryNoticeDays: z.number().int().min(0).max(90).optional(),
    /** Whether members may redeem rewards themselves in the app. */
    memberRedeemEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.expiryMode !== 'MONTHS_AFTER_EARN' || (v.expiryMonths ?? null) !== null, {
    message: 'Son kullanma için ay sayısı giriniz',
    path: ['expiryMonths'],
  });
export type UpdateLoyaltySettingsInput = z.infer<typeof UpdateLoyaltySettingsSchema>;

export interface LoyaltySettingsDTO {
  enabled: boolean;
  expiryMode: LoyaltyExpiryMode;
  expiryMonths: number | null;
  expiryNoticeDays: number;
  memberRedeemEnabled: boolean;
  /** The studio currency: PURCHASE_AMOUNT rules and DISCOUNT_AMOUNT rewards default to it. */
  currency: string;
}

// ---------------------------------------------------------------------------
// Earn rules
// ---------------------------------------------------------------------------

const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'Geçersiz para birimi');

export const LoyaltyRuleConditionsSchema = z
  .object({
    /** ATTENDANCE: only these service types (empty or missing = all). */
    serviceTypeIds: z.array(z.string().uuid()).max(100).optional(),
    /** PURCHASE_AMOUNT: only payments for these package definitions (empty or missing = all). */
    packageDefinitionIds: z.array(z.string().uuid()).max(100).optional(),
    /** BADGE: only these badge definitions (empty or missing = every badge). */
    badgeDefinitionIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict();
export type LoyaltyRuleConditions = z.infer<typeof LoyaltyRuleConditionsSchema>;

const RuleBase = {
  name: z.string().trim().min(1, 'Ad giriniz').max(120),
  points: z.number().int().min(1).max(LOYALTY_MAX_POINTS),
  /** PURCHASE_AMOUNT: points are given per this much of `currency` (e.g. 1 point per 10). */
  perAmount: z.number().positive().max(1_000_000).nullable().optional(),
  currency: CurrencySchema.nullable().optional(),
  conditions: LoyaltyRuleConditionsSchema.default({}),
  isActive: z.boolean().default(true),
};

export const CreateLoyaltyRuleSchema = z
  .object({ kind: z.enum(LOYALTY_RULE_KINDS), ...RuleBase })
  .strict()
  .refine((v) => v.kind !== 'PURCHASE_AMOUNT' || (v.perAmount != null && v.currency != null), {
    message: 'Tutar kuralı için tutar ve para birimi giriniz',
    path: ['perAmount'],
  });
export type CreateLoyaltyRuleInput = z.infer<typeof CreateLoyaltyRuleSchema>;

export const UpdateLoyaltyRuleSchema = z
  .object({
    name: RuleBase.name.optional(),
    points: RuleBase.points.optional(),
    perAmount: RuleBase.perAmount,
    currency: RuleBase.currency,
    conditions: LoyaltyRuleConditionsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateLoyaltyRuleInput = z.infer<typeof UpdateLoyaltyRuleSchema>;

export interface LoyaltyRuleDTO {
  id: string;
  kind: LoyaltyRuleKind;
  name: string;
  points: number;
  perAmount: string | null;
  currency: string | null;
  conditions: LoyaltyRuleConditions;
  isActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

const RewardBase = {
  name: z.string().trim().min(1, 'Ad giriniz').max(120),
  description: z.string().trim().max(500).nullable().optional(),
  costPoints: z.number().int().min(1).max(LOYALTY_MAX_POINTS),
  /** DISCOUNT_AMOUNT: amount; DISCOUNT_PERCENT: 1-100; EXTRA_SESSION_CREDIT: units; GIFT: unused. */
  value: z.number().positive().max(1_000_000).nullable().optional(),
  currency: CurrencySchema.nullable().optional(),
  /** Days the issued promotion code stays valid. */
  validityDays: z.number().int().min(1).max(365).default(90),
  isActive: z.boolean().default(true),
  /** Whether members may pick this reward in the app (when the program allows it). */
  memberRedeemable: z.boolean().default(true),
};

function rewardValueIssue(v: { type: LoyaltyRewardType; value?: number | null; currency?: string | null }): string | null {
  switch (v.type) {
    case 'DISCOUNT_AMOUNT':
      return v.value != null && v.currency != null ? null : 'İndirim tutarı ve para birimi giriniz';
    case 'DISCOUNT_PERCENT':
      return v.value != null && v.value <= 100 ? null : 'İndirim yüzdesi 1-100 arasında olmalıdır';
    case 'EXTRA_SESSION_CREDIT':
      return v.value != null && Number.isInteger(v.value) ? null : 'Eklenecek hak sayısı tam sayı olmalıdır';
    case 'GIFT':
      return null;
  }
}

export const CreateLoyaltyRewardSchema = z
  .object({ type: z.enum(LOYALTY_REWARD_TYPES), ...RewardBase })
  .strict()
  .superRefine((v, ctx) => {
    const issue = rewardValueIssue(v);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue, path: ['value'] });
  });
export type CreateLoyaltyRewardInput = z.infer<typeof CreateLoyaltyRewardSchema>;

export const UpdateLoyaltyRewardSchema = z
  .object({
    name: RewardBase.name.optional(),
    description: RewardBase.description,
    costPoints: RewardBase.costPoints.optional(),
    value: RewardBase.value,
    currency: RewardBase.currency,
    validityDays: z.number().int().min(1).max(365).optional(),
    isActive: z.boolean().optional(),
    memberRedeemable: z.boolean().optional(),
  })
  .strict();
export type UpdateLoyaltyRewardInput = z.infer<typeof UpdateLoyaltyRewardSchema>;

/** Checks an updated reward as a whole (the type never changes). */
export function validateLoyaltyReward(v: { type: LoyaltyRewardType; value: number | null; currency: string | null }): string | null {
  return rewardValueIssue(v);
}

export interface LoyaltyRewardDTO {
  id: string;
  name: string;
  description: string | null;
  type: LoyaltyRewardType;
  costPoints: number;
  value: string | null;
  currency: string | null;
  validityDays: number;
  isActive: boolean;
  memberRedeemable: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Ledger, balance, adjustments and redemptions
// ---------------------------------------------------------------------------

export const LoyaltyAdjustSchema = z
  .object({
    /** Signed: positive adds, negative removes (never below zero). */
    points: z
      .number()
      .int()
      .min(-LOYALTY_MAX_POINTS)
      .max(LOYALTY_MAX_POINTS)
      .refine((n) => n !== 0, 'Puan sıfır olamaz'),
    note: z.string().trim().min(1, 'Açıklama giriniz').max(300),
    /** A MANUAL preset rule, for reporting. */
    ruleId: z.string().uuid().optional(),
    /** Client-generated key: a retried request never adjusts twice. */
    idempotencyKey: z.string().trim().min(8).max(80).optional(),
  })
  .strict();
export type LoyaltyAdjustInput = z.infer<typeof LoyaltyAdjustSchema>;

export const LoyaltyRedeemSchema = z
  .object({
    rewardId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(8).max(80).optional(),
  })
  .strict();
export type LoyaltyRedeemInput = z.infer<typeof LoyaltyRedeemSchema>;

export const LoyaltyLedgerQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type LoyaltyLedgerQuery = z.infer<typeof LoyaltyLedgerQuerySchema>;

export interface LoyaltyLedgerEntryDTO {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: LoyaltyReason;
  sourceType: LoyaltySourceType;
  note: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface LoyaltyRedemptionDTO {
  id: string;
  rewardName: string;
  type: LoyaltyRewardType;
  pointsSpent: number;
  value: string | null;
  currency: string | null;
  /** DISCOUNT_*: the single-use promotion code the member presents at checkout. */
  promoCode: string | null;
  promoCodeValidTo: string | null;
  /** EXTRA_SESSION_CREDIT: the package that received the units. */
  memberPackageId: string | null;
  createdAt: string;
}

export interface LoyaltyExpiringDTO {
  points: number;
  expiresAt: string;
}

export interface LoyaltyBalanceDTO {
  enabled: boolean;
  balance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  /** The next lot that expires with points still unspent, if any. */
  nextExpiry: LoyaltyExpiringDTO | null;
}

export interface LoyaltyMemberSummaryDTO extends LoyaltyBalanceDTO {
  membershipId: string;
  ledger: LoyaltyLedgerEntryDTO[];
  redemptions: LoyaltyRedemptionDTO[];
  /** Active rewards; `affordable` is false when the balance is too low. */
  rewards: (LoyaltyRewardDTO & { affordable: boolean })[];
  /** MANUAL presets for the adjustment form. */
  presets: LoyaltyRuleDTO[];
  memberRedeemEnabled: boolean;
}

export interface LoyaltyLedgerPageDTO {
  items: LoyaltyLedgerEntryDTO[];
  total: number;
  page: number;
  limit: number;
}

export interface LoyaltyRedeemResultDTO {
  redemption: LoyaltyRedemptionDTO;
  balance: number;
  /** A retried request (same idempotency key) returned the first result. */
  duplicate: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (shared by the API and the tests)
// ---------------------------------------------------------------------------

/**
 * Points a payment earns under a PURCHASE_AMOUNT rule: `points` for every
 * whole `perAmount` of the net paid amount. Currencies must match (rule 8):
 * a payment in another currency earns nothing under this rule.
 */
export function purchaseAmountPoints(
  paid: { amount: number; currency: string },
  rule: { points: number; perAmount: number | null; currency: string | null },
): number {
  if (!rule.perAmount || rule.perAmount <= 0 || !rule.currency) return 0;
  if (rule.currency.toUpperCase() !== paid.currency.toUpperCase()) return 0;
  if (!Number.isFinite(paid.amount) || paid.amount <= 0) return 0;
  // Cents first so 0.1 + 0.2 style float noise never loses a unit.
  const units = Math.floor(Math.round(paid.amount * 100) / Math.round(rule.perAmount * 100));
  return Math.min(LOYALTY_MAX_POINTS, units * rule.points);
}

/** `from` plus whole calendar months (the day is clamped to the target month's last day). */
export function addMonthsUtc(from: Date, months: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(from.getUTCDate(), lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, day, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}

export interface LoyaltyLotInput {
  id: string;
  delta: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface LoyaltyLotRemainder {
  id: string;
  remaining: number;
  expiresAt: Date | null;
}

/**
 * FIFO lots: every positive row is a lot, every negative row a debit.
 * Debits consume lots soonest-expiring first (never-expiring lots last,
 * ties by earn time), so the result does not depend on when a debit
 * happened and the expiry job can recompute it from the immutable rows at
 * any time. Returns each lot's unspent remainder, in consumption order.
 */
export function remainingLots(rows: readonly LoyaltyLotInput[]): LoyaltyLotRemainder[] {
  const lots = rows
    .filter((r) => r.delta > 0)
    .slice()
    .sort((a, b) => {
      const ea = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
      const eb = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
      if (ea !== eb) return ea - eb;
      const ca = a.createdAt.getTime();
      const cb = b.createdAt.getTime();
      if (ca !== cb) return ca - cb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  let debit = rows.filter((r) => r.delta < 0).reduce((sum, r) => sum - r.delta, 0);
  return lots.map((lot) => {
    const used = Math.min(lot.delta, debit);
    debit -= used;
    return { id: lot.id, remaining: lot.delta - used, expiresAt: lot.expiresAt };
  });
}

/** Lots already past their expiry with points left: what the expiry job writes off. */
export function lotsToExpire(rows: readonly LoyaltyLotInput[], now: Date): LoyaltyLotRemainder[] {
  return remainingLots(rows).filter((l) => l.remaining > 0 && l.expiresAt !== null && l.expiresAt.getTime() <= now.getTime());
}

/** Points that expire within the window (after now, up to `until`), and the earliest date. */
export function expiringWithin(rows: readonly LoyaltyLotInput[], now: Date, until: Date): { points: number; firstExpiresAt: Date | null } {
  let points = 0;
  let first: Date | null = null;
  for (const lot of remainingLots(rows)) {
    if (lot.remaining <= 0 || !lot.expiresAt) continue;
    const t = lot.expiresAt.getTime();
    if (t <= now.getTime() || t > until.getTime()) continue;
    points += lot.remaining;
    if (!first || t < first.getTime()) first = lot.expiresAt;
  }
  return { points, firstExpiresAt: first };
}
