import { z } from 'zod';
import { PAYOUT_ERROR_CODES } from './payouts';
import { CurrencyCodeSchema } from './growth/regions';
import type { PermissionKey } from './permissions';
import type { MessageKey } from './i18n/messages';
import { PLATFORM_ACCESS_TRANSLATED_ERRORS } from './platform-permissions';
import { ADD_ON_TRANSLATED_ERRORS } from './add-on-errors';
import { MARKETING_APPROVAL_TRANSLATED_ERRORS } from './marketing/approvals';
import { SOCIAL_TRANSLATED_ERRORS } from './marketing/social';
import { OAUTH_TRANSLATED_ERRORS } from './marketing/oauth';
import { CONSENT_CONFIRMATION_TRANSLATED_ERRORS } from './marketing/consent';

/**
 * Platform billing of tenants (G5c-1, docs/DENEME_VE_ETKINLESTIRME.md):
 * trial, activation, restricted mode and business-to-business referral
 * credits. The tenant is the platform's customer here; nothing in this file
 * is about a tenant's own members.
 */

// ---------------------------------------------------------------------------
// Billing status
// ---------------------------------------------------------------------------

/** Studio.billingStatus values. */
export const STUDIO_BILLING_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'RESTRICTED', 'CANCELLED'] as const;
export type StudioBillingStatus = (typeof STUDIO_BILLING_STATUSES)[number];

export function isStudioBillingStatus(value: string): value is StudioBillingStatus {
  return (STUDIO_BILLING_STATUSES as readonly string[]).includes(value);
}

/**
 * Allowed transitions. The API refuses anything else, so a stale request
 * can never move an ACTIVE studio back into a trial, for example.
 * - TRIALING -> ACTIVE (paid), RESTRICTED (trial expired or forced), CANCELLED
 * - RESTRICTED -> ACTIVE (paid or forced), TRIALING (super admin extended the trial), CANCELLED
 * - ACTIVE -> PAST_DUE (renewal failed), RESTRICTED (forced), CANCELLED
 * - PAST_DUE -> ACTIVE (paid), RESTRICTED, CANCELLED
 * - CANCELLED -> ACTIVE (paid again or forced)
 */
const TRANSITIONS: Readonly<Record<StudioBillingStatus, readonly StudioBillingStatus[]>> = {
  TRIALING: ['ACTIVE', 'RESTRICTED', 'CANCELLED'],
  RESTRICTED: ['ACTIVE', 'TRIALING', 'CANCELLED'],
  ACTIVE: ['PAST_DUE', 'RESTRICTED', 'CANCELLED'],
  PAST_DUE: ['ACTIVE', 'RESTRICTED', 'CANCELLED'],
  CANCELLED: ['ACTIVE'],
};

export function canTransitionBillingStatus(from: StudioBillingStatus, to: StudioBillingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses in which writes on core modules are refused (restricted mode). */
export function isWriteRestricted(status: string | null | undefined): boolean {
  return status === 'RESTRICTED' || status === 'CANCELLED';
}

/** Stable error code of a write refused in restricted mode; clients translate `billing.error.BILLING_RESTRICTED`. */
export const BILLING_RESTRICTED_ERROR_CODE = 'BILLING_RESTRICTED';

/**
 * Restricted mode (docs/DENEME_VE_ETKINLESTIRME.md "Kısıtlı mod"). Reads
 * (GET) are always allowed. A write on a studio-scoped endpoint is allowed
 * only when EVERY permission the endpoint requires is in this list, or the
 * handler is explicitly marked @AllowWhenRestricted() in the API. Anything
 * else (new bookings, sessions, sales, campaigns, members, ...) is refused
 * with BILLING_RESTRICTED. Super admins are never restricted; auth,
 * billing/activation and /admin routes are not studio-scoped writes and
 * are not affected.
 */
export const RESTRICTED_MODE_ALLOWED_WRITE_PERMISSIONS: readonly PermissionKey[] = [
  // Activation, plan choice and the referral page.
  'billing.manage',
  // Business profile, logo and region: fixing details before paying.
  'studio.settings.manage',
  // Removing a leaver's access is a security action, never blocked.
  'roles.manage',
  'staff.manage',
  // Exports (data portability) stay available.
  'crm.export',
  'accounting.export',
];

export function isAllowedWhenRestricted(required: readonly string[]): boolean {
  return required.length > 0 && required.every((key) => (RESTRICTED_MODE_ALLOWED_WRITE_PERMISSIONS as readonly string[]).includes(key));
}

// ---------------------------------------------------------------------------
// Platform billing currency (G5c-1b)
// ---------------------------------------------------------------------------

/**
 * Currencies the platform bills its tenants in. A plan has one price per
 * currency (plan_prices); a studio pays in exactly one of these. Adding a
 * currency is one entry here, the countries that use it in
 * PLATFORM_BILLING_CURRENCY_BY_COUNTRY and a price per plan entered by the
 * super admin (no migration).
 */
export const PLATFORM_BILLING_CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP'] as const;
export type PlatformBillingCurrency = (typeof PLATFORM_BILLING_CURRENCIES)[number];
export const PlatformBillingCurrencySchema = z.enum(PLATFORM_BILLING_CURRENCIES);

/** Billing currency of every country not listed below. */
export const FALLBACK_PLATFORM_BILLING_CURRENCY: PlatformBillingCurrency = 'USD';

/** Euro area member states (Bulgaria since 2026-01-01). */
const EURO_AREA = ['AT', 'BE', 'BG', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'] as const;

/** United Kingdom and the Crown dependencies (Guernsey, Jersey, Isle of Man). */
const POUND_AREA = ['GB', 'GG', 'JE', 'IM'] as const;

/** Country (ISO 3166-1 alpha-2) -> platform billing currency, as data. */
export const PLATFORM_BILLING_CURRENCY_BY_COUNTRY: Readonly<Record<string, PlatformBillingCurrency>> = {
  TR: 'TRY',
  ...Object.fromEntries(POUND_AREA.map((code) => [code, 'GBP' as const])),
  ...Object.fromEntries(EURO_AREA.map((code) => [code, 'EUR' as const])),
};

export function isPlatformBillingCurrency(value: string | null | undefined): value is PlatformBillingCurrency {
  return typeof value === 'string' && (PLATFORM_BILLING_CURRENCIES as readonly string[]).includes(value);
}

/** The currency a business in this country pays the platform in (TR -> TRY, euro area -> EUR, UK -> GBP, else USD). */
export function platformBillingCurrencyOf(countryCode: string | null | undefined): PlatformBillingCurrency {
  if (!countryCode) return FALLBACK_PLATFORM_BILLING_CURRENCY;
  return PLATFORM_BILLING_CURRENCY_BY_COUNTRY[countryCode.trim().toUpperCase()] ?? FALLBACK_PLATFORM_BILLING_CURRENCY;
}

/**
 * The studio's effective billing currency: the super admin's override
 * (Studio.billingCurrency) when set and still offered, otherwise the one
 * derived from the studio's country.
 */
export function studioBillingCurrency(studio: { billingCurrency?: string | null; countryCode: string | null | undefined }): PlatformBillingCurrency {
  return isPlatformBillingCurrency(studio.billingCurrency) ? studio.billingCurrency : platformBillingCurrencyOf(studio.countryCode);
}

/** One monthly price of a plan. `priceMonthly` is a decimal string. */
export interface PlanPriceDTO {
  currency: PlatformBillingCurrency;
  priceMonthly: string;
}

/** The plan's price in `currency`, or null when the plan is not offered in it. */
export function planPriceIn<T extends { currency: string }>(prices: readonly T[], currency: string): T | null {
  return prices.find((p) => p.currency === currency) ?? null;
}

/** Stable error codes of the billing currency rules; clients translate `billing.error.<code>`. */
export const BILLING_CURRENCY_LOCKED_ERROR_CODE = 'BILLING_CURRENCY_LOCKED';
export const PLAN_PRICE_UNAVAILABLE_ERROR_CODE = 'PLAN_PRICE_UNAVAILABLE';

/** Super admin: pin a studio's billing currency, or null to derive it from the country again. */
export const AdminSetBillingCurrencySchema = z
  .object({
    currency: PlatformBillingCurrencySchema.nullable(),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();
export type AdminSetBillingCurrencyInput = z.infer<typeof AdminSetBillingCurrencySchema>;

// ---------------------------------------------------------------------------
// Trial
// ---------------------------------------------------------------------------

/** Fallback trial length when no plan is known; the real value is Plan.trialDays. */
export const DEFAULT_TRIAL_DAYS = 14;
export const MAX_TRIAL_DAYS = 365;
/** Owner reminders go out when this many days (or fewer) are left, each once per trial end. */
export const TRIAL_REMINDER_DAYS = [7, 3, 1] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Trial end for a trial starting now with the given length. */
export function trialEndFrom(start: Date, trialDays: number): Date {
  return new Date(start.getTime() + Math.max(0, trialDays) * DAY_MS);
}

/**
 * Whole days left in the trial, rounded up (23 hours left is 1 day), never
 * negative. Null when there is no trial end.
 */
export function trialDaysLeft(trialEndsAt: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!trialEndsAt) return null;
  const end = typeof trialEndsAt === 'string' ? new Date(trialEndsAt) : trialEndsAt;
  const ms = end.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

export function isTrialExpired(trialEndsAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!trialEndsAt) return false;
  const end = typeof trialEndsAt === 'string' ? new Date(trialEndsAt) : trialEndsAt;
  return end.getTime() <= now.getTime();
}

/**
 * Which reminder (7, 3 or 1 days) is due now, or null. A late heartbeat
 * sends only the most urgent due threshold, never a burst of older ones;
 * `lastSentDays` is the smallest threshold already sent for this trial end.
 */
export function dueTrialReminder(daysLeft: number | null, lastSentDays: number | null | undefined): number | null {
  if (daysLeft === null || daysLeft <= 0) return null;
  const due = TRIAL_REMINDER_DAYS.filter((d) => daysLeft <= d);
  if (due.length === 0) return null;
  const threshold = Math.min(...due);
  if (lastSentDays !== null && lastSentDays !== undefined && lastSentDays <= threshold) return null;
  return threshold;
}

/** Transactional owner messages (built-in tr/en defaults in message-templates.ts). */
export const BILLING_TEMPLATE_KEYS = {
  trialEnding: 'TRIAL_ENDING',
  trialRestricted: 'TRIAL_RESTRICTED',
} as const;

// ---------------------------------------------------------------------------
// Platform payments and credits
// ---------------------------------------------------------------------------

export const PLATFORM_PAYMENT_STATUSES = ['PENDING', 'COMPLETED', 'FAILED'] as const;
export type PlatformPaymentStatus = (typeof PLATFORM_PAYMENT_STATUSES)[number];

export const PLATFORM_CREDIT_KINDS = ['REFERRAL_REWARD', 'APPLIED', 'ADJUSTMENT'] as const;
export type PlatformCreditKind = (typeof PLATFORM_CREDIT_KINDS)[number];

export const REFERRAL_REWARD_KINDS = ['AMOUNT', 'FREE_MONTHS'] as const;
export type ReferralRewardKind = (typeof REFERRAL_REWARD_KINDS)[number];

const DecimalAmount = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Geçersiz tutar');

/**
 * Super-admin setting: what a referrer earns when a referred business pays.
 * AMOUNT holds one amount per platform billing currency (G5c-1b); the
 * referrer is credited in its own billing currency. A currency without an
 * amount falls back to DEFAULT_REFERRAL_REWARD for that referrer.
 */
export const ReferralRewardSettingSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('AMOUNT'),
        amounts: z
          .array(z.object({ currency: PlatformBillingCurrencySchema, amount: DecimalAmount }).strict())
          .min(1)
          .max(PLATFORM_BILLING_CURRENCIES.length),
      })
      .strict(),
    z.object({ kind: z.literal('FREE_MONTHS'), months: z.number().int().min(1).max(12) }).strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.kind !== 'AMOUNT') return;
    const currencies = value.amounts.map((a) => a.currency);
    if (new Set(currencies).size !== currencies.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amounts'], message: 'Her para birimi bir kez girilebilir' });
    }
  });
export type ReferralRewardSetting = z.infer<typeof ReferralRewardSettingSchema>;

/** Owner decision (G5c-1b): one free month unless the super admin sets otherwise. */
export const DEFAULT_REFERRAL_REWARD: ReferralRewardSetting = { kind: 'FREE_MONTHS', months: 1 };

export const UpdatePlatformBillingSettingsSchema = z.object({ referralReward: ReferralRewardSettingSchema }).strict();
export type UpdatePlatformBillingSettingsInput = z.infer<typeof UpdatePlatformBillingSettingsSchema>;

/** One ledger entry to write when a referral is rewarded. */
export interface ReferralRewardEntry {
  amount: string | null;
  currency: string | null;
  months: number | null;
}

/**
 * The ledger entry for a referrer billed in `currency`: the AMOUNT in that
 * currency, or the free months. An AMOUNT setting with no amount in that
 * currency falls back to DEFAULT_REFERRAL_REWARD (money is never converted).
 */
export function referralRewardEntry(setting: ReferralRewardSetting, currency: string): ReferralRewardEntry {
  if (setting.kind === 'FREE_MONTHS') return { amount: null, currency: null, months: setting.months };
  const match = setting.amounts.find((a) => a.currency === currency);
  if (match) return { amount: match.amount, currency: match.currency, months: null };
  // DEFAULT_REFERRAL_REWARD is FREE_MONTHS, so this never recurses twice.
  return referralRewardEntry(DEFAULT_REFERRAL_REWARD, currency);
}

/** Signed ledger rows reduced to a balance: money per currency and free months. */
export interface CreditBalance {
  amounts: { currency: string; amount: string }[];
  months: number;
}

export interface CreditLedgerLike {
  amount: string | null;
  currency: string | null;
  months: number | null;
}

function toCents(amount: string): number {
  const negative = amount.trim().startsWith('-');
  const [whole, fraction = ''] = amount.trim().replace(/^[-+]/, '').split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function creditBalanceOf(rows: readonly CreditLedgerLike[]): CreditBalance {
  const byCurrency = new Map<string, number>();
  let months = 0;
  for (const row of rows) {
    if (row.amount !== null && row.currency) byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + toCents(row.amount));
    if (row.months !== null) months += row.months;
  }
  return {
    amounts: [...byCurrency.entries()]
      .filter(([, cents]) => cents > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, cents]) => ({ currency, amount: fromCents(cents) })),
    months: Math.max(0, months),
  };
}

export interface CreditApplication {
  /** What the provider charges after credits, as a decimal string. */
  payable: string;
  /** Money credit used (same currency as the charge), "0.00" when none. */
  creditAmount: string;
  /** Free months used (0 or more). */
  creditMonths: number;
}

/**
 * How a charge consumes credits. Free months first: each covers one month
 * of the period in full. Then money credit in the charge's own currency
 * (never converted) up to the remaining amount. Credits in another
 * currency stay on the balance.
 */
export function applyCredits(charge: { amount: string; currency: string; periodMonths: number }, balance: CreditBalance): CreditApplication {
  const periodMonths = Math.max(1, Math.floor(charge.periodMonths));
  const total = toCents(charge.amount);
  const perMonth = Math.floor(total / periodMonths);
  const monthsUsed = Math.min(balance.months, periodMonths);
  let remaining = monthsUsed === periodMonths ? 0 : total - perMonth * monthsUsed;
  const money = balance.amounts.find((a) => a.currency === charge.currency);
  const moneyUsed = money ? Math.min(toCents(money.amount), remaining) : 0;
  remaining -= moneyUsed;
  return { payable: fromCents(Math.max(0, remaining)), creditAmount: fromCents(moneyUsed), creditMonths: monthsUsed };
}

// ---------------------------------------------------------------------------
// Business-to-business referrals
// ---------------------------------------------------------------------------

/** URL parameter carrying a business referral code on the platform site. */
export const REFERRAL_TRACKING_PARAM = 'pw_ref';
/** Same unambiguous alphabet as member referral codes (no 0/O/1/I). */
export const STUDIO_REFERRAL_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
export const StudioReferralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(STUDIO_REFERRAL_CODE_PATTERN, 'Geçersiz tavsiye kodu');

/** Reads and normalises pw_ref from a landing URL; null when absent or malformed. */
export function parseReferralParam(url: string): string | null {
  const match = /[?&]pw_ref=([^&#]*)/.exec(url);
  if (!match) return null;
  let value: string;
  try {
    value = decodeURIComponent(match[1].replace(/\+/g, ' ')).trim().toUpperCase();
  } catch {
    return null;
  }
  return STUDIO_REFERRAL_CODE_PATTERN.test(value) ? value : null;
}

export const STUDIO_REFERRAL_STATUSES = ['SIGNED_UP', 'REWARDED', 'REJECTED'] as const;
export type StudioReferralStatus = (typeof STUDIO_REFERRAL_STATUSES)[number];
export const STUDIO_REFERRAL_SOURCES = ['TOUCHPOINT', 'MANUAL'] as const;
export type StudioReferralSource = (typeof STUDIO_REFERRAL_SOURCES)[number];
/** Why a referral earned nothing; the UI translates `billing.referral.reject.<reason>`. */
export const STUDIO_REFERRAL_REJECT_REASONS = ['SELF_REFERRAL', 'REFERRER_INACTIVE'] as const;
export type StudioReferralRejectReason = (typeof STUDIO_REFERRAL_REJECT_REASONS)[number];

export interface ReferralParty {
  studioId: string;
  ownerPhones: readonly string[];
  ownerEmails: readonly (string | null)[];
}

/**
 * Self-referral: the referrer and the referred business are the same
 * studio, or share an owner phone or email. Users are global and phone
 * unique, so the same person owning both shows up as the same phone.
 */
export function isSelfReferral(referrer: ReferralParty, referred: ReferralParty): boolean {
  if (referrer.studioId === referred.studioId) return true;
  const phones = new Set(referrer.ownerPhones);
  if (referred.ownerPhones.some((p) => phones.has(p))) return true;
  const emails = new Set(referrer.ownerEmails.filter((e): e is string => Boolean(e)).map((e) => e.trim().toLowerCase()));
  return referred.ownerEmails.some((e) => Boolean(e) && emails.has((e as string).trim().toLowerCase()));
}

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------

export const ActivateStudioSchema = z
  .object({
    planKey: z.string().trim().min(1).max(60),
    installmentCount: z.number().int().min(1).max(12).default(1),
  })
  .strict();
export type ActivateStudioInput = z.infer<typeof ActivateStudioSchema>;

export const ExtendTrialSchema = z.object({ days: z.number().int().min(1).max(90) }).strict();
export type ExtendTrialInput = z.infer<typeof ExtendTrialSchema>;

export const AdminForceBillingStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'RESTRICTED']),
    /** Plan to activate on (ACTIVE only); defaults to the studio's current plan. */
    planKey: z.string().trim().min(1).max(60).optional(),
    reason: z.string().trim().max(300).optional(),
    /**
     * ACTIVE only (G5c-1b): count the forced activation as a paying
     * customer, i.e. record studio_paid at the plan's list price in the
     * studio's billing currency and reward the referrer, exactly as a paid
     * activation does (both once per studio). Default false.
     */
    recordAsPaid: z.boolean().default(false),
  })
  .strict();
export type AdminForceBillingStatusInput = z.infer<typeof AdminForceBillingStatusSchema>;

export interface BillingPlanDTO {
  key: string;
  name: string;
  priceMonthly: string;
  currency: string;
  trialDays: number;
}

/** The studio's current plan; its price is null when the plan has no price in the studio's billing currency. */
export interface CurrentBillingPlanDTO extends Omit<BillingPlanDTO, 'priceMonthly'> {
  priceMonthly: string | null;
}

export interface StudioBillingDTO {
  status: StudioBillingStatus;
  /** Currency the studio pays the platform in (override or derived from its country). */
  billingCurrency: PlatformBillingCurrency;
  /** True once a platform payment has completed: the billing currency is then fixed. */
  billingCurrencyLocked: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  activatedAt: string | null;
  plan: CurrentBillingPlanDTO | null;
  currentPeriodEnd: string | null;
  credit: CreditBalance;
  /** Active plans with a price in the billing currency: the ones the owner can activate. */
  plans: BillingPlanDTO[];
}

export interface PlatformPaymentDTO {
  id: string;
  /** Null on an add-on payment (G5c-2); those carry `addOn` instead. */
  planKey: string | null;
  /** The add-on this payment is for (G5c-2), null on a plan payment. */
  addOn: { key: string; name: Record<string, string> } | null;
  listAmount: string;
  creditAmount: string;
  creditMonths: number;
  amount: string;
  currency: string;
  status: PlatformPaymentStatus;
  paidAt: string | null;
  createdAt: string;
}

export interface ActivateStudioResultDTO {
  status: StudioBillingStatus;
  /** True while a real provider's hosted checkout has not confirmed yet. */
  pending: boolean;
  checkoutUrl: string | null;
  payment: PlatformPaymentDTO;
}

/** Session summary on MembershipDTO: enough for the banner without another request. */
export interface MembershipBillingSummary {
  status: StudioBillingStatus;
  trialEndsAt: string | null;
}

export interface StudioReferralItemDTO {
  id: string;
  referredStudioName: string;
  status: StudioReferralStatus;
  rejectReason: StudioReferralRejectReason | null;
  createdAt: string;
  rewardedAt: string | null;
  reward: ReferralRewardEntry | null;
}

export interface StudioReferralOverviewDTO {
  code: string;
  /** Query string to append to the platform site URL, e.g. "?pw_ref=K3F7QANB". */
  query: string;
  referrals: StudioReferralItemDTO[];
  credit: CreditBalance;
  /** What this studio earns per paying referral, in its own billing currency. */
  reward: ReferralRewardEntry;
}

export interface AdminStudioReferralDTO {
  id: string;
  referrerStudioId: string;
  referrerStudioName: string;
  referredStudioId: string;
  referredStudioName: string;
  code: string;
  source: StudioReferralSource;
  status: StudioReferralStatus;
  rejectReason: StudioReferralRejectReason | null;
  createdAt: string;
  rewardedAt: string | null;
}

export interface AdminReferralOverviewDTO {
  reward: ReferralRewardSetting;
  totals: { signedUp: number; rewarded: number; rejected: number };
  items: AdminStudioReferralDTO[];
}

/** API error codes the web BFF and the mobile client translate into the viewer's language. */
export const TRANSLATED_API_ERROR_CODES: Readonly<Record<string, MessageKey>> = {
  [BILLING_RESTRICTED_ERROR_CODE]: 'billing.error.BILLING_RESTRICTED',
  [PAYOUT_ERROR_CODES.notFound]: 'payouts.error.PAYOUT_NOT_FOUND',
  [PAYOUT_ERROR_CODES.itemNotFound]: 'payouts.error.PAYOUT_ITEM_NOT_FOUND',
  [PAYOUT_ERROR_CODES.itemNotMatchable]: 'payouts.error.PAYOUT_ITEM_NOT_MATCHABLE',
  [PAYOUT_ERROR_CODES.paymentNotFound]: 'payouts.error.PAYOUT_PAYMENT_NOT_FOUND',
  [PAYOUT_ERROR_CODES.currencyMismatch]: 'payouts.error.PAYOUT_CURRENCY_MISMATCH',
  [PAYOUT_ERROR_CODES.tooManyRows]: 'payouts.error.PAYOUT_TOO_MANY_ROWS',
  [PAYOUT_ERROR_CODES.unknownProvider]: 'payouts.error.PAYOUT_UNKNOWN_PROVIDER',
  [BILLING_CURRENCY_LOCKED_ERROR_CODE]: 'billing.error.BILLING_CURRENCY_LOCKED',
  [PLAN_PRICE_UNAVAILABLE_ERROR_CODE]: 'billing.error.PLAN_PRICE_UNAVAILABLE',
  ...ADD_ON_TRANSLATED_ERRORS,
  ...PLATFORM_ACCESS_TRANSLATED_ERRORS,
  ...MARKETING_APPROVAL_TRANSLATED_ERRORS,
  ...SOCIAL_TRANSLATED_ERRORS,
  ...OAUTH_TRANSLATED_ERRORS,
  ...CONSENT_CONFIRMATION_TRANSLATED_ERRORS,
};
