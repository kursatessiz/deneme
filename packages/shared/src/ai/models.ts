import { z } from 'zod';

/**
 * AI core (G3b, docs/YAPAY_ZEKA.md): the tasks the platform runs on a
 * language model, the default model per task, the price table used to
 * estimate cost, and the cost arithmetic. Everything here is pure so the
 * API, the super-admin screens and the tests share one definition.
 */

export const AI_TASKS = ['TRANSLATION', 'COPYWRITING', 'REPLY_SUGGESTION', 'MARKETING_DRAFT', 'MARKETING_ANALYSIS', 'MARKETING_RESEARCH'] as const;
export type AiTask = (typeof AI_TASKS)[number];
export const AiTaskSchema = z.enum(AI_TASKS);

/**
 * Default model per task. The cheapest model that does the job well: UI
 * translation and marketing copy need a strong writer, a short inbox reply
 * does not. The super admin can change each one in the AI settings.
 */
export const DEFAULT_AI_MODELS: Readonly<Record<AiTask, string>> = Object.freeze({
  TRANSLATION: 'claude-sonnet-5',
  COPYWRITING: 'claude-sonnet-5',
  REPLY_SUGGESTION: 'claude-haiku-4-5-20251001',
  MARKETING_DRAFT: 'claude-sonnet-5',
  MARKETING_ANALYSIS: 'claude-sonnet-5',
  MARKETING_RESEARCH: 'claude-sonnet-5',
});

/** Model ids as the provider names them, e.g. "claude-sonnet-5" or "claude-haiku-4-5-20251001". */
export const AiModelIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9.-]*$/, 'Geçersiz model kimliği');

/**
 * USD per million tokens. One token at $X per million costs exactly X
 * micro-dollars, which is why costs are stored in micro-USD (see
 * estimateCostMicroUsd): a cent is too coarse for a single short call.
 */
export const AiModelPriceSchema = z
  .object({
    inputPerMTok: z.number().min(0).max(1000),
    outputPerMTok: z.number().min(0).max(1000),
    cacheWritePerMTok: z.number().min(0).max(1000),
    cacheReadPerMTok: z.number().min(0).max(1000),
  })
  .strict();
export type AiModelPrice = z.infer<typeof AiModelPriceSchema>;

/**
 * Anthropic list prices (first-party API). Cache writes (5 minute TTL) cost
 * 1.25x input and cache reads 0.1x input unless the model has its own read
 * price. The super admin can override any row in the AI settings when the
 * provider changes a price; unknown models fall back to AI_FALLBACK_PRICE.
 */
export const AI_PRICE_TABLE: Readonly<Record<string, AiModelPrice>> = Object.freeze({
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, cacheWritePerMTok: 5, cacheReadPerMTok: 0.2 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
});

/** Deliberately high so an unpriced model never looks cheaper than it is. */
export const AI_FALLBACK_PRICE: AiModelPrice = Object.freeze({
  inputPerMTok: 10,
  outputPerMTok: 50,
  cacheWritePerMTok: 12.5,
  cacheReadPerMTok: 1,
});

export const MICRO_USD_PER_CENT = 10_000;

/** Monthly AI budget of a tenant whose plan and override set none: 5 USD. */
export const DEFAULT_TENANT_AI_BUDGET_CENTS = 500;

/**
 * The tasks of the platform marketing studio (docs/PAZARLAMA_MODULU.md 4.1).
 * Their spend on the platform tenant is additionally capped by the platform
 * setting `marketingAiMonthlyBudgetCents`.
 */
export const MARKETING_AI_TASKS = ['MARKETING_DRAFT', 'MARKETING_ANALYSIS', 'MARKETING_RESEARCH'] as const satisfies readonly AiTask[];
export function isMarketingAiTask(task: string): boolean {
  return (MARKETING_AI_TASKS as readonly string[]).includes(task);
}

/** Monthly AI budget of the marketing studio when the super admin set none: 50 USD. */
export const DEFAULT_MARKETING_AI_BUDGET_CENTS = 5000;

export function resolveModelPrice(model: string, overrides?: Readonly<Record<string, AiModelPrice>> | null): AiModelPrice {
  const own = (table: Readonly<Record<string, AiModelPrice>> | null | undefined, id: string): AiModelPrice | undefined =>
    table && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
  // A dated snapshot ("...-20251001") is priced like its alias when only the alias is listed.
  const alias = model.replace(/-\d{8}$/, '');
  return own(overrides, model) ?? own(overrides, alias) ?? own(AI_PRICE_TABLE, model) ?? own(AI_PRICE_TABLE, alias) ?? AI_FALLBACK_PRICE;
}

export interface AiTokenUsage {
  /** Uncached input tokens. */
  inputTokens: number;
  outputTokens: number;
  /** Input tokens written to the prompt cache. */
  cacheCreationTokens: number;
  /** Input tokens served from the prompt cache. */
  cacheReadTokens: number;
}

/** Estimated cost of one call in micro-USD (1e-6 USD), rounded to a whole micro-dollar. */
export function estimateCostMicroUsd(usage: AiTokenUsage, price: AiModelPrice): number {
  const raw =
    usage.inputTokens * price.inputPerMTok +
    usage.outputTokens * price.outputPerMTok +
    usage.cacheCreationTokens * price.cacheWritePerMTok +
    usage.cacheReadTokens * price.cacheReadPerMTok;
  return Math.round(raw);
}

export function centsToMicroUsd(cents: number): number {
  return cents * MICRO_USD_PER_CENT;
}

/** Whole cents, rounded up so a started cent is shown as spent. */
export function microUsdToCents(microUsd: number): number {
  return Math.ceil(microUsd / MICRO_USD_PER_CENT);
}

/** "YYYY-MM" of an instant in UTC; AI budgets reset on the first day of the UTC month. */
export function aiBudgetMonthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** First instant of the UTC month containing `date`. */
export function aiBudgetMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
