import { z } from 'zod';
import { LocaleCodeSchema } from '../i18n/locales';
import { AiModelIdSchema, AiModelPriceSchema, type AiModelPrice, type AiTask } from './models';

/**
 * Request schemas and response shapes of the AI endpoints
 * (docs/YAPAY_ZEKA.md). Super-admin: /admin/ai/*. Tenant:
 * /studios/:studioId/ai/* (permission ai.use) and the inbox reply
 * suggestion (inbox.reply + ai.use).
 */

/**
 * Error codes the API sends in `code` next to a Turkish `message`; clients
 * show `t('ai.error.<code>')` so the text follows the viewer's language.
 */
export const AI_ERROR_CODES = [
  'AI_NOT_CONFIGURED',
  'AI_MONTHLY_LIMIT_REACHED',
  'AI_AUTH_FAILED',
  'AI_RATE_LIMITED',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_BAD_REQUEST',
  'AI_REFUSED',
  'AI_INVALID_OUTPUT',
  'AI_ENCRYPTION_UNAVAILABLE',
  'MARKETING_AI_BUDGET_EXCEEDED',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && (AI_ERROR_CODES as readonly string[]).includes(value);
}

// -- super admin: settings --------------------------------------------------

export type AiKeySource = 'DATABASE' | 'ENV';

export interface AiSettingsDTO {
  /** True when a key is available (stored or from ANTHROPIC_API_KEY); every AI feature is off otherwise. */
  configured: boolean;
  keySource: AiKeySource | null;
  /** Last four characters of the active key; the key itself is never returned. */
  keyLast4: string | null;
  keyUpdatedAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestErrorCode: AiErrorCode | null;
  models: Record<AiTask, string>;
  priceOverrides: Record<string, AiModelPrice>;
  /** Built-in price table merged with the overrides, for display. */
  effectivePrices: Record<string, AiModelPrice>;
  defaultMonthlyBudgetCents: number;
  /** Monthly cap of the marketing studio on the platform tenant, in cents. */
  marketingAiMonthlyBudgetCents: number;
  /** QUEUE with Redis (BullMQ), HEARTBEAT otherwise (the 15-minute scheduler picks jobs up). */
  jobMode: 'QUEUE' | 'HEARTBEAT';
}

export const SetAiApiKeySchema = z
  .object({
    // Printable ASCII only; the provider's keys never contain spaces.
    apiKey: z
      .string()
      .trim()
      .min(20)
      .max(300)
      .regex(/^[\x21-\x7e]+$/, 'Geçersiz anahtar'),
  })
  .strict();
export type SetAiApiKeyInput = z.infer<typeof SetAiApiKeySchema>;

export const UpdateAiSettingsSchema = z
  .object({
    models: z
      .object({
        TRANSLATION: AiModelIdSchema.optional(),
        COPYWRITING: AiModelIdSchema.optional(),
        REPLY_SUGGESTION: AiModelIdSchema.optional(),
        MARKETING_DRAFT: AiModelIdSchema.optional(),
        MARKETING_ANALYSIS: AiModelIdSchema.optional(),
        MARKETING_RESEARCH: AiModelIdSchema.optional(),
      })
      .strict()
      .optional(),
    /** Replaces the whole override map; `{}` clears it. */
    priceOverrides: z
      .record(AiModelIdSchema, AiModelPriceSchema)
      .refine((v) => Object.keys(v).length <= 30, 'En fazla 30 model')
      .optional(),
    defaultMonthlyBudgetCents: z.number().int().min(0).max(100_000_000).optional(),
    /** Monthly cap of the marketing studio on the platform tenant (cents); 0 switches the studio off. */
    marketingAiMonthlyBudgetCents: z.number().int().min(0).max(100_000_000).optional(),
  })
  .strict();
export type UpdateAiSettingsInput = z.infer<typeof UpdateAiSettingsSchema>;

export interface AiConnectionTestDTO {
  ok: boolean;
  errorCode: AiErrorCode | null;
  model: string;
}

/** PUT /admin/ai/tenants/:studioId/limit; null removes the override (plan, then platform default). */
export const SetTenantAiLimitSchema = z
  .object({
    monthlyBudgetCents: z.number().int().min(0).max(100_000_000).nullable(),
  })
  .strict();
export type SetTenantAiLimitInput = z.infer<typeof SetTenantAiLimitSchema>;

// -- super admin: usage dashboard -------------------------------------------

export const AiUsageQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(24).default(6),
  })
  .strict();
export type AiUsageQuery = z.infer<typeof AiUsageQuerySchema>;

export interface AiUsageTotals {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costMicroUsd: number;
}

export type AiBudgetSource = 'OVERRIDE' | 'PLAN' | 'DEFAULT';

export interface AiTenantUsageRow extends AiUsageTotals {
  /** Null for platform jobs (translation) that belong to no tenant. */
  studioId: string | null;
  studioName: string | null;
  currentMonthCostMicroUsd: number;
  budgetCents: number | null;
  budgetSource: AiBudgetSource | null;
  overrideCents: number | null;
}

export interface AiUsageDashboardDTO {
  /** "YYYY-MM", oldest first; the last one is the current UTC month. */
  months: string[];
  byMonth: Array<AiUsageTotals & { month: string }>;
  byTask: Array<AiUsageTotals & { task: AiTask }>;
  byTenant: AiTenantUsageRow[];
}

// -- tenant ------------------------------------------------------------------

export const AI_DRAFT_KINDS = ['CAMPAIGN', 'EMAIL', 'SMS', 'PAGE_BLOCK'] as const;
export type AiDraftKind = (typeof AI_DRAFT_KINDS)[number];

export const AI_DRAFT_TONES = ['FRIENDLY', 'FORMAL', 'ENERGETIC', 'CALM'] as const;
export type AiDraftTone = (typeof AI_DRAFT_TONES)[number];

export const AiDraftSchema = z
  .object({
    kind: z.enum(AI_DRAFT_KINDS),
    brief: z.string().trim().min(3).max(1000),
    locale: LocaleCodeSchema,
    tone: z.enum(AI_DRAFT_TONES).default('FRIENDLY'),
  })
  .strict();
export type AiDraftInput = z.infer<typeof AiDraftSchema>;

export interface AiDraftDTO {
  /** Plain text; `{placeholders}` the tenant's templates support may appear. */
  text: string;
  /** Email subject for EMAIL drafts, null otherwise. */
  subject: string | null;
}

export const AiSuggestReplySchema = z
  .object({
    /** Language of the reply; defaults to the language of the conversation or the studio default. */
    locale: LocaleCodeSchema.optional(),
  })
  .strict();
export type AiSuggestReplyInput = z.infer<typeof AiSuggestReplySchema>;

export interface AiReplySuggestionDTO {
  text: string;
}

/** GET /studios/:studioId/ai/status: lets the UI show the AI buttons in the right state. */
export interface AiTenantStatusDTO {
  configured: boolean;
  budgetCents: number;
  usedMicroUsd: number;
  limitReached: boolean;
}
