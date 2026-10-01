import type { BackupStatusDTO } from './backups';
import { z } from 'zod';
import { DocumentType, FeatureFlagScope, InviteChannel, NotificationChannel } from './enums';
import { PhoneSchema } from './validators';
import { CountryCodeSchema } from './growth/regions';
import { PLATFORM_BILLING_CURRENCIES, PlatformBillingCurrencySchema, StudioReferralCodeSchema } from './billing';
import type { PlanPriceDTO, PlatformBillingCurrency, StudioBillingStatus } from './billing';
import { EmailBlocksSchema } from './email-blocks';
import { WHATSAPP_TEMPLATE_STATUSES } from './message-templates';
import { DEFAULT_THEME_FAMILY, OPTIONAL_THEME_FAMILY_KEYS, THEME_FAMILY_KEYS } from './design/themes';
import type { ThemeFamilyKey } from './design/themes';

// ---------------------------------------------------------------------------
// Super-admin (platform owner) panel: backlog 4.1-4.3.
// Every payload the /admin/* API accepts or returns is defined once here,
// shared between apps/api validation and apps/web forms (CLAUDE.md rule 3).
// ---------------------------------------------------------------------------

/** Catalog of known feature flag keys, for the admin UI's picker. A flag
 * itself is a free-form string (see FeatureFlag.key), so this list is
 * documentation and UI convenience, not an enum enforced by the API. */
export const FEATURE_FLAGS = {
  gamification: 'Rozet, seri ve aylik hedef ozellikleri',
  churn_risk: 'Kayip riski puanlama ve panosu',
  video_content: 'Kayitli/canli video icerik modulu',
  partner_integrations: 'Pazaryeri/aggregator partner entegrasyonlari',
  health_sync: 'Apple Health / Health Connect senkronizasyonu',
  e_invoice: 'e-Arsiv / e-Fatura entegrasyonu',
  online_payments: 'iyzico/PayTR online tahsilat',
  promotions: 'Promosyon kodu ve hediye karti',
  referrals: 'Referans (tavsiye) programi',
  leads_pipeline: 'Potansiyel musteri (lead) hattı',
  public_api: 'Herkese acik API ve API anahtarlari',
  webhooks: 'Giden webhook bildirimleri',
  'theme_family.noir': 'Tema ailesi: Studio Noir (isletme icin izin)',
  'theme_family.nefes': 'Tema ailesi: Nefes (isletme icin izin)',
  'theme_family.saha': 'Tema ailesi: Saha (isletme icin izin)',
  'theme_family.atolye': 'Tema ailesi: Atolye (isletme icin izin)',
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

// -- Tenants ------------------------------------------------------------

export const CreateTenantSchema = z.object({
  name: z.string().trim().min(2, 'İşletme adı en az 2 karakter olmalıdır').max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,60}$/, 'Slug yalnızca küçük harf, rakam ve tire içerebilir'),
  businessTypeTemplateKey: z.string().min(1, 'İşletme türü şablonu seçilmelidir'),
  planKey: z.string().min(1, 'Plan seçilmelidir'),
  /** Drives the new studio's default currency, timezone, tax regime and default locale (countryDefaultsOf). */
  countryCode: CountryCodeSchema,
  ownerFirstName: z.string().trim().min(1, 'Sahibin adı zorunludur').max(60),
  ownerLastName: z.string().trim().min(1, 'Sahibin soyadı zorunludur').max(60),
  ownerPhone: PhoneSchema,
  ownerChannel: z.nativeEnum(InviteChannel).default(InviteChannel.SHOWN),
  /** Business referral code the new owner was given (G5c-1); optional, validated against existing studios. */
  referralCode: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), StudioReferralCodeSchema.optional()),
});
export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

export const AssignPlanSchema = z.object({
  planKey: z.string().min(1),
});
export type AssignPlanInput = z.infer<typeof AssignPlanSchema>;

// -- Plans ----------------------------------------------------------------

export const PlanLimitsSchema = z
  .object({
    maxBranches: z.number().int().positive().optional(),
    maxActiveMembers: z.number().int().positive().optional(),
    maxStaff: z.number().int().positive().optional(),
    maxSmsPerMonth: z.number().int().positive().optional(),
    /** Monthly AI budget in US cents (G3b); 0 turns AI off for the plan's tenants. */
    aiMonthlyBudgetCents: z.number().int().min(0).optional(),
  })
  .partial();
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

/** One monthly price of a plan in a platform billing currency (G5c-1b). */
export const PlanPriceInputSchema = z
  .object({
    currency: PlatformBillingCurrencySchema,
    priceMonthly: z.number().nonnegative().max(99_999_999),
  })
  .strict();
export type PlanPriceInput = z.infer<typeof PlanPriceInputSchema>;

export const UpsertPlanSchema = z
  .object({
    key: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(100),
    /**
     * Monthly price per platform billing currency (G5c-1b). When given it is
     * the full set: a currency left out is no longer offered. Omitted keeps
     * the stored prices. A new plan needs at least one price.
     */
    prices: z.array(PlanPriceInputSchema).min(1).max(PLATFORM_BILLING_CURRENCIES.length).optional(),
    /** Deprecated single price (G5c-1): same as adding { currency, priceMonthly } to the stored prices. */
    priceMonthly: z.number().nonnegative().max(99_999_999).optional(),
    currency: PlatformBillingCurrencySchema.optional(),
    /** Free trial length for new businesses on this plan (G5c-1); omitted keeps the stored value. */
    trialDays: z.number().int().min(0).max(365).optional(),
    limits: PlanLimitsSchema.default({}),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.prices) {
      const currencies = value.prices.map((p) => p.currency);
      if (new Set(currencies).size !== currencies.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prices'], message: 'Her para birimi bir kez girilebilir' });
      }
    }
    if (value.priceMonthly !== undefined && !value.currency) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['currency'], message: 'Fiyatın para birimi seçilmelidir' });
    }
  });
export type UpsertPlanInput = z.infer<typeof UpsertPlanSchema>;

// -- Business type templates ----------------------------------------------

export const UpsertBusinessTypeTemplateSchema = z.object({
  key: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(100),
  vocabulary: z.record(z.string(), z.string()).default({}),
  defaults: z.record(z.string(), z.unknown()).default({}),
  enabledModules: z.array(z.string().min(1)).default([]),
  isActive: z.boolean().default(true),
});
export type UpsertBusinessTypeTemplateInput = z.infer<typeof UpsertBusinessTypeTemplateSchema>;

// -- Feature flags ----------------------------------------------------------

export const SetFeatureFlagSchema = z
  .object({
    key: z.string().trim().min(1).max(80),
    scope: z.nativeEnum(FeatureFlagScope),
    businessTypeTemplateId: z.string().uuid().optional(),
    studioId: z.string().uuid().optional(),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === FeatureFlagScope.BUSINESS_TYPE && !value.businessTypeTemplateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessTypeTemplateId'],
        message: 'İş türü kapsamı için şablon seçilmelidir',
      });
    }
    if (value.scope === FeatureFlagScope.TENANT && !value.studioId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['studioId'], message: 'Kiracı kapsamı için işletme seçilmelidir' });
    }
    if (value.scope === FeatureFlagScope.GLOBAL && (value.businessTypeTemplateId || value.studioId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scope'], message: 'Global kapsamda ek hedef belirtilemez' });
    }
  });
export type SetFeatureFlagInput = z.infer<typeof SetFeatureFlagSchema>;

// -- Theme families (D7) -------------------------------------------------------

/** Stable error code of a theme write that names a family the super admin did not allow. */
export const THEME_FAMILY_NOT_ALLOWED = 'THEME_FAMILY_NOT_ALLOWED';

/** The super admin's view of one studio's theme families: the allow-list and the stored family. */
export interface TenantThemeFamiliesDTO {
  /** Always contains the default family. */
  allowed: ThemeFamilyKey[];
  /** The family stored on the studio (it may be outside `allowed`, in which case it renders as the default). */
  current: ThemeFamilyKey;
}

export const UpdateTenantThemeFamiliesSchema = z
  .object({
    /** Optional families to allow; the default family is implied. */
    allowed: z.array(z.enum(OPTIONAL_THEME_FAMILY_KEYS)).max(OPTIONAL_THEME_FAMILY_KEYS.length),
    current: z.enum(THEME_FAMILY_KEYS),
  })
  .refine((v) => v.current === DEFAULT_THEME_FAMILY || (v.allowed as readonly string[]).includes(v.current), {
    path: ['current'],
    message: 'Mevcut aile izin verilen ailelerden biri olmalıdır',
  });
export type UpdateTenantThemeFamiliesInput = z.infer<typeof UpdateTenantThemeFamiliesSchema>;

// -- SMS packages ------------------------------------------------------------

export const UpsertSmsPackageSchema = z.object({
  key: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(100),
  credits: z.number().int().positive(),
  price: z.number().nonnegative(),
  isActive: z.boolean().default(true),
});
export type UpsertSmsPackageInput = z.infer<typeof UpsertSmsPackageSchema>;

// -- Global message templates and document versions -------------------------

/**
 * Mirrors the tenant-facing UpsertMessageTemplateSchema (messaging.ts) plus
 * `studioId`: null publishes/edits the global default template every tenant
 * falls back to, a uuid edits one tenant's override. Kept separate (not an
 * intersection) because the tenant schema is `.strict()`, which would
 * reject the extra `studioId` field.
 */
export const AdminUpsertMessageTemplateSchema = z
  .object({
    studioId: z.string().uuid().nullable().default(null),
    key: z.string().trim().min(1).max(60),
    channel: z.nativeEnum(NotificationChannel),
    locale: z.string().trim().min(2).max(5).default('tr'),
    body: z.string().trim().min(1, 'Şablon metni boş olamaz').max(2000),
    whatsappTemplateName: z.string().trim().max(120).optional(),
    /** Meta approval state of the WhatsApp template; admin-entered names are treated as approved unless stated. */
    whatsappStatus: z.enum(WHATSAPP_TEMPLATE_STATUSES).default('APPROVED'),
    /** EMAIL: subject line (required) and block-based body (optional; `body` becomes one paragraph when absent). */
    subject: z.string().trim().min(1).max(200).nullable().optional(),
    blocks: EmailBlocksSchema.nullable().optional(),
    isTransactional: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.channel !== NotificationChannel.WHATSAPP || !!v.whatsappTemplateName, {
    message: 'WhatsApp şablonları için onaylı şablon adı zorunludur',
    path: ['whatsappTemplateName'],
  })
  .refine((v) => v.channel !== NotificationChannel.EMAIL || !!v.subject, {
    message: 'E-posta şablonları için konu zorunludur',
    path: ['subject'],
  });
export type AdminUpsertMessageTemplateInput = z.infer<typeof AdminUpsertMessageTemplateSchema>;

export const PublishDocumentVersionSchema = z.object({
  studioId: z.string().uuid().nullable().default(null),
  type: z.nativeEnum(DocumentType),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1),
});
export type PublishDocumentVersionInput = z.infer<typeof PublishDocumentVersionSchema>;

// -- Benchmark ---------------------------------------------------------------

export const BenchmarkQuerySchema = z.object({
  businessTypeTemplateKey: z.string().optional(),
});
export type BenchmarkQueryInput = z.infer<typeof BenchmarkQuerySchema>;

/** Minimum studios per bucket before a benchmark figure is published; below
 * this, the bucket is suppressed entirely rather than showing a figure that
 * could identify a single tenant. */
export const BENCHMARK_MIN_GROUP_SIZE = 5;

export interface BenchmarkBucket {
  businessTypeTemplateKey: string;
  businessTypeTemplateName: string;
  studioCount: number;
  suppressed: boolean;
  avgOccupancyRate: number | null;
  avgCancellationRate: number | null;
  avgRevenuePerMember: number | null;
  avgRenewalRate: number | null;
}

// -- System health -----------------------------------------------------------

export interface SystemHealthDTO {
  database: { status: 'ok' | 'error'; latencyMs: number };
  redis: { status: 'ok' | 'error' | 'not_configured' };
  queueDepth: number | null;
  lastHeartbeatRunAt: string | null;
  failedWebhookDeliveries: number;
  smsProvider: {
    provider: 'MOCK' | 'NETGSM' | 'ILETI_MERKEZI' | 'TWILIO';
    status: 'ok' | 'low_balance' | 'error' | 'skipped';
    credits: number | null;
    threshold: number;
    checkedAt: string;
  } | null;
  /** D2: age of the newest successful backup (docs/YEDEKLER.md). */
  backup: BackupStatusDTO;
}

// -- Tenant listing DTOs ------------------------------------------------------

export interface TenantListItemDTO {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  businessTypeTemplateKey: string | null;
  planKey: string | null;
  subscriptionStatus: string | null;
  branchCount: number;
  activeMemberCount: number;
  staffCount: number;
  createdAt: string;
  /** Platform billing (G5c-1). */
  billingStatus: StudioBillingStatus;
  trialEndsAt: string | null;
  activatedAt: string | null;
  /** ISO 3166-1 alpha-2 country of the business. */
  countryCode: string;
  /** Effective platform billing currency (G5c-1b): the override, else derived from the country. */
  billingCurrency: PlatformBillingCurrency;
  /** Super-admin override; null when the currency follows the country. */
  billingCurrencyOverride: PlatformBillingCurrency | null;
}

/** GET /admin/plans item (G5c-1b): prices per billing currency. */
export interface AdminPlanDTO {
  id: string;
  key: string;
  name: string;
  prices: PlanPriceDTO[];
  trialDays: number;
  limits: PlanLimits;
  isActive: boolean;
  createdAt: string;
}

export interface TenantDetailDTO extends TenantListItemDTO {
  phone: string | null;
  email: string | null;
  timezone: string;
  planLimits: PlanLimits | null;
}
