import { z } from 'zod';
import { PLATFORM_BILLING_CURRENCIES, PlatformBillingCurrencySchema, planPriceIn, trialDaysLeft } from './billing';
import type { PlatformBillingCurrency } from './billing';
import { addMonthsUtc } from './loyalty';
import { vmsg } from './validation-key';

/**
 * Add-on marketplace (G5c-2, docs/UYGULAMA_PAZARI.md): platform-defined
 * modules a tenant can try and buy on top of its plan. The catalogue is
 * super admin data (no code per add-on); an add-on unlocks one feature flag
 * key, and a tenant's ACTIVE or TRIALING (not expired) `studio_add_ons` row
 * enables that flag for the tenant. Every amount carries its currency.
 */

// ---------------------------------------------------------------------------
// Status and intervals
// ---------------------------------------------------------------------------

export const ADD_ON_STATUSES = ['TRIALING', 'ACTIVE', 'CANCELLED', 'EXPIRED'] as const;
export type AddOnStatus = (typeof ADD_ON_STATUSES)[number];

export function isAddOnStatus(value: string): value is AddOnStatus {
  return (ADD_ON_STATUSES as readonly string[]).includes(value);
}

export const ADD_ON_INTERVALS = ['MONTH', 'YEAR'] as const;
export type AddOnInterval = (typeof ADD_ON_INTERVALS)[number];
export const AddOnIntervalSchema = z.enum(ADD_ON_INTERVALS);

/** What the tenant sees per add-on: AVAILABLE when the tenant has no row for it yet. */
export const ADD_ON_TENANT_STATES = ['AVAILABLE', 'TRIALING', 'ACTIVE', 'CANCELLED', 'EXPIRED'] as const;
export type AddOnTenantState = (typeof ADD_ON_TENANT_STATES)[number];

/** Stable reason an add-on is shown but cannot be bought. */
export const ADD_ON_BLOCK_REASONS = ['NO_PRICE_IN_CURRENCY'] as const;
export type AddOnBlockReason = (typeof ADD_ON_BLOCK_REASONS)[number];

// ---------------------------------------------------------------------------
// Per-locale text
// ---------------------------------------------------------------------------

/** Text per locale; Turkish and English are always present, other locales are optional. */
export type LocalizedText = Record<string, string>;

export function localizedTextSchema(maxLength: number) {
  return z
    .record(z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/), z.string().trim().max(maxLength))
    .refine((v) => (v.tr ?? '').length > 0 && (v.en ?? '').length > 0, { message: vmsg('validation.turkishAndEnglishTextAreRequired') });
}

/**
 * The text in `locale`: exact locale, then its language, then English, then
 * Turkish, then any non-empty value. Never throws; an empty string only when
 * the object has no text at all.
 */
export function localizedText(text: LocalizedText | null | undefined, locale: string): string {
  if (!text) return '';
  const language = locale.split('-')[0] ?? locale;
  for (const candidate of [locale, language, 'en', 'tr']) {
    const value = text[candidate];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  for (const value of Object.values(text)) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Catalogue (super admin)
// ---------------------------------------------------------------------------

export const ADD_ON_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,59}$/;
export const FEATURE_FLAG_KEY_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
export const ADD_ON_MAX_SCREENSHOTS = 8;
export const ADD_ON_MAX_TRIAL_DAYS = 90;
export const DEFAULT_ADD_ON_TRIAL_DAYS = 14;

const HttpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => u.startsWith('https://'), { message: vmsg('validation.onlyHttpsLinksAreAccepted') });

const AddOnFieldsSchema = z.object({
  name: localizedTextSchema(100),
  description: localizedTextSchema(1000),
  promoVideoUrl: HttpsUrl.nullable(),
  screenshotUrls: z.array(HttpsUrl).max(ADD_ON_MAX_SCREENSHOTS),
  featureFlagKey: z.string().trim().regex(FEATURE_FLAG_KEY_PATTERN, vmsg('validation.invalidFeatureKey')),
  trialDays: z.number().int().min(0).max(ADD_ON_MAX_TRIAL_DAYS),
  isPublished: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
});

export const CreateAddOnSchema = AddOnFieldsSchema.extend({
  key: z.string().trim().regex(ADD_ON_KEY_PATTERN, vmsg('validation.invalidKey')),
  promoVideoUrl: HttpsUrl.nullable().default(null),
  screenshotUrls: z.array(HttpsUrl).max(ADD_ON_MAX_SCREENSHOTS).default([]),
  trialDays: z.number().int().min(0).max(ADD_ON_MAX_TRIAL_DAYS).default(DEFAULT_ADD_ON_TRIAL_DAYS),
  isPublished: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
}).strict();
export type CreateAddOnInput = z.infer<typeof CreateAddOnSchema>;

export const UpdateAddOnSchema = AddOnFieldsSchema.partial().strict();
export type UpdateAddOnInput = z.infer<typeof UpdateAddOnSchema>;

const PriceAmount = z
  .number()
  .positive()
  .max(1_000_000)
  .refine((n) => Math.round(n * 100) / 100 === n, { message: vmsg('validation.mostTwoDecimalPlaces') });

export const AddOnPriceInputSchema = z
  .object({ currency: PlatformBillingCurrencySchema, priceMonthly: PriceAmount, priceYearly: PriceAmount })
  .strict();
export type AddOnPriceInput = z.infer<typeof AddOnPriceInputSchema>;

/** The full price set of an add-on: a currency left out is removed (the add-on is no longer sold in it). */
export const SetAddOnPricesSchema = z
  .object({ prices: z.array(AddOnPriceInputSchema).max(PLATFORM_BILLING_CURRENCIES.length) })
  .strict()
  .refine((v) => new Set(v.prices.map((p) => p.currency)).size === v.prices.length, { message: 'Her para birimi bir kez girilebilir', path: ['prices'] });
export type SetAddOnPricesInput = z.infer<typeof SetAddOnPricesSchema>;

export interface AddOnPriceDTO {
  currency: PlatformBillingCurrency;
  /** Decimal string, e.g. "49.00". */
  priceMonthly: string;
  priceYearly: string;
}

export interface AdminAddOnDTO {
  id: string;
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  promoVideoUrl: string | null;
  screenshotUrls: string[];
  featureFlagKey: string;
  trialDays: number;
  isPublished: boolean;
  sortOrder: number;
  prices: AddOnPriceDTO[];
  /** Tenants with a TRIALING or ACTIVE (not expired) row for this add-on. */
  tenantCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Add-on revenue of completed platform payments, one entry per currency (never summed across currencies). */
export interface AddOnRevenueDTO {
  currency: string;
  amount: string;
  payments: number;
}

export interface AdminAddOnRevenueDTO {
  items: AddOnRevenueDTO[];
}

// ---------------------------------------------------------------------------
// Price snapshot and lookup
// ---------------------------------------------------------------------------

/** studio_add_ons.price_snapshot: what the tenant was quoted, so a later catalogue change never surprises a running subscription. */
export interface AddOnPriceSnapshot {
  currency: string;
  priceMonthly: string;
  priceYearly: string;
  /** Null while trialing (no interval chosen yet). */
  interval: AddOnInterval | null;
  /** The recurring charge: the monthly or yearly price by interval; null while trialing. */
  amount: string | null;
}

export function buildAddOnSnapshot(price: AddOnPriceDTO, interval: AddOnInterval | null): AddOnPriceSnapshot {
  return {
    currency: price.currency,
    priceMonthly: price.priceMonthly,
    priceYearly: price.priceYearly,
    interval,
    amount: interval === null ? null : interval === 'YEAR' ? price.priceYearly : price.priceMonthly,
  };
}

/** Narrow an untrusted JSON value back to a snapshot; null when it is not one. */
export function parseAddOnSnapshot(value: unknown): AddOnPriceSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.currency !== 'string' || typeof v.priceMonthly !== 'string' || typeof v.priceYearly !== 'string') return null;
  const interval = v.interval === 'MONTH' || v.interval === 'YEAR' ? v.interval : null;
  const amount = typeof v.amount === 'string' ? v.amount : null;
  return { currency: v.currency, priceMonthly: v.priceMonthly, priceYearly: v.priceYearly, interval, amount };
}

/** The add-on's price in the tenant's billing currency, or null (shown but not purchasable). */
export function addOnPriceIn<T extends { currency: string }>(prices: readonly T[], currency: string): T | null {
  return planPriceIn(prices, currency);
}

// ---------------------------------------------------------------------------
// Access and period math
// ---------------------------------------------------------------------------

export interface AddOnAccessRow {
  status: string;
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
}

function ms(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const t = (typeof value === 'string' ? new Date(value) : value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * True when the row currently unlocks its module: TRIALING before the trial
 * end, ACTIVE (also while a failed renewal is being retried; the heartbeat
 * expires it when the retries run out), CANCELLED until the paid period
 * ends. EXPIRED never.
 */
export function addOnHasAccess(row: AddOnAccessRow, now: Date = new Date()): boolean {
  switch (row.status) {
    case 'TRIALING': {
      const end = ms(row.trialEndsAt);
      return end !== null && end > now.getTime();
    }
    case 'ACTIVE':
      return true;
    case 'CANCELLED': {
      const end = ms(row.currentPeriodEnd);
      return end !== null && end > now.getTime();
    }
    default:
      return false;
  }
}

export function addOnPeriodEnd(from: Date, interval: AddOnInterval): Date {
  return addMonthsUtc(from, interval === 'YEAR' ? 12 : 1);
}

/** Lifecycle step the heartbeat applies to a row, or null when nothing is due. */
export type AddOnExpiryReason = 'TRIAL_ENDED' | 'CANCELLED_PERIOD_ENDED' | 'RENEWAL_FAILED';

export function dueAddOnExpiry(row: AddOnAccessRow, now: Date = new Date()): AddOnExpiryReason | null {
  if (row.status === 'TRIALING') {
    const end = ms(row.trialEndsAt);
    return end !== null && end <= now.getTime() ? 'TRIAL_ENDED' : null;
  }
  if (row.status === 'CANCELLED') {
    const end = ms(row.currentPeriodEnd);
    return end !== null && end <= now.getTime() ? 'CANCELLED_PERIOD_ENDED' : null;
  }
  return null;
}

/** ACTIVE and past its period end: a renewal charge is due. */
export function isAddOnRenewalDue(
  row: { status: string; currentPeriodEnd: Date | string | null; nextRenewalAttemptAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (row.status !== 'ACTIVE') return false;
  const end = ms(row.currentPeriodEnd);
  if (end === null || end > now.getTime()) return false;
  const next = ms(row.nextRenewalAttemptAt);
  return next === null || next <= now.getTime();
}

// ---------------------------------------------------------------------------
// Dunning and reminders
// ---------------------------------------------------------------------------

/** Days until the next attempt after the 1st, 2nd and 3rd failed renewal charge; the 4th failure ends the subscription. */
export const ADD_ON_DUNNING_RETRY_DAYS = [1, 3, 5] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * After a failed renewal charge (`failures` counts it, starting at 1): when
 * to try again, or null when the retries are used up and the add-on expires.
 */
export function nextDunningAttempt(failures: number, now: Date): Date | null {
  const days = ADD_ON_DUNNING_RETRY_DAYS[failures - 1];
  return days === undefined ? null : new Date(now.getTime() + days * DAY_MS);
}

/** In-app and e-mail notice this many days before a trial ends (once). */
export const ADD_ON_TRIAL_REMINDER_DAYS = 3;

export function isAddOnTrialReminderDue(row: { status: string; trialEndsAt: Date | string | null; trialReminderSentAt: Date | string | null }, now: Date = new Date()): boolean {
  if (row.status !== 'TRIALING' || row.trialReminderSentAt) return false;
  const left = trialDaysLeft(row.trialEndsAt, now);
  return left !== null && left > 0 && left <= ADD_ON_TRIAL_REMINDER_DAYS;
}

export const ADD_ON_TEMPLATE_KEYS = {
  trialEnding: 'ADDON_TRIAL_ENDING',
  renewalFailed: 'ADDON_RENEWAL_FAILED',
} as const;

// ---------------------------------------------------------------------------
// Effective feature resolution
// ---------------------------------------------------------------------------

export interface FeatureResolutionInput {
  /** Explicit TENANT-scope flag row (the super admin's per-tenant decision), or null when none exists. */
  tenant: boolean | null;
  /** The tenant has an entitling add-on row for this flag (ACTIVE, TRIALING not expired, CANCELLED within its period). */
  addOnEntitled: boolean;
  businessType: boolean | null;
  global: boolean | null;
}

/**
 * Effective feature flag of a tenant: an explicit TENANT row wins (also when
 * it disables, so the super admin keeps a kill switch); otherwise an
 * entitling add-on turns the feature on; otherwise the BUSINESS_TYPE row,
 * then the GLOBAL row; a flag with no row at all is off. An add-on can only
 * enable a feature, never disable one another scope enables.
 */
export function resolveEffectiveFeature(input: FeatureResolutionInput): boolean {
  if (input.tenant !== null) return input.tenant;
  if (input.addOnEntitled) return true;
  if (input.businessType !== null) return input.businessType;
  if (input.global !== null) return input.global;
  return false;
}

// ---------------------------------------------------------------------------
// Tenant-facing DTOs and inputs
// ---------------------------------------------------------------------------

export const ActivateAddOnSchema = z.object({ interval: AddOnIntervalSchema }).strict();
export type ActivateAddOnInput = z.infer<typeof ActivateAddOnSchema>;

export interface StudioAddOnDTO {
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  promoVideoUrl: string | null;
  screenshotUrls: string[];
  featureFlagKey: string;
  trialDays: number;
  state: AddOnTenantState;
  /** True while the add-on currently unlocks its module. */
  hasAccess: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  activatedAt: string | null;
  cancelledAt: string | null;
  currentPeriodEnd: string | null;
  /** Interval of the running subscription; null while trialing or never bought. */
  billingInterval: AddOnInterval | null;
  /** Price in the tenant's billing currency; null when the add-on has none in it. */
  price: AddOnPriceDTO | null;
  purchasable: boolean;
  purchaseBlockedReason: AddOnBlockReason | null;
  /** True when the tenant can start the free trial now (never used, purchasable, trial length above zero). */
  trialAvailable: boolean;
  /** ACTIVE but the renewal charge is past due (retries running): the owner can pay now with activate. */
  paymentOverdue: boolean;
}

export interface StudioAddOnListDTO {
  billingCurrency: PlatformBillingCurrency;
  /** Web page where the owner manages add-ons (opened from the mobile read-only screen). */
  manageUrl: string;
  items: StudioAddOnDTO[];
}

export interface StudioAddOnActionResultDTO {
  item: StudioAddOnDTO;
  /** True while a real provider's hosted checkout has not confirmed yet. */
  pending: boolean;
  checkoutUrl: string | null;
}

/** Effective features of the current tenant, for module-off empty states. */
export interface StudioFeaturesDTO {
  /** Feature flag keys that are on for the tenant. */
  enabled: string[];
  /** Flags that are off but that a published add-on would unlock: the add-on to send the owner to. */
  unlockableBy: { featureFlagKey: string; addOnKey: string; name: LocalizedText }[];
}
