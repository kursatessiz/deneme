import { z } from 'zod';
import { CONVERSION_EVENT_TYPES } from '../growth/conversions';
import { computeCac, computeCpl, computeRoas } from '../growth/ads';
import { CurrencyCodeSchema, MoneySchema } from '../growth/regions';
import type { Money } from '../growth/regions';
import { compareKpi } from '../report-compare';
import { medianOf } from '../funnels';
import { redactPii } from './privacy';
import { AdSpendCapStatusSchema, FUSE_REASONS } from './guards';
import { AdCapPauseSchema } from './ad-cap-pause';
import { vmsg } from '../validation-key';

/**
 * Platform marketing dashboard (M3a, docs/PAZARLAMA_MODULU.md 3.3). One
 * read-only endpoint, `GET /platform/marketing/dashboard`, returns aggregate
 * numbers only, never a person. Money is always reported per currency and
 * never summed across currencies (CLAUDE.md rule 8). The API computes the
 * inputs in SQL; every ratio, delta and warning level below is pure so the
 * unit tests and the API share one definition.
 */

export const DASHBOARD_DEFAULT_RANGE_DAYS = 30;
export const DASHBOARD_MAX_RANGE_DAYS = 366;
/** Period presets of the picker; a custom range is any from/to inside DASHBOARD_MAX_RANGE_DAYS. */
export const DASHBOARD_PERIOD_PRESET_DAYS = [7, 30, 90] as const;
/** Channel health windows, counted back from the end of the selected period. */
export const CHANNEL_HEALTH_WINDOW_DAYS = [7, 30] as const;

/** Bounce above 2 percent and complaints above 0.08 percent put an e-mail sender at risk; the screen warns above these. */
export const EMAIL_BOUNCE_WARNING_RATE = 0.02;
export const EMAIL_COMPLAINT_WARNING_RATE = 0.0008;
/** The AI budget bar turns to a warning from this share of the monthly budget. */
export const AI_BUDGET_WARNING_RATIO = 0.8;
/** Longest connection error text returned to the client. */
export const DASHBOARD_ERROR_TEXT_MAX = 200;
/** Rows kept per channel table. */
export const DASHBOARD_CHANNEL_ROWS_MAX = 10;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export const DashboardQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    compare: z.enum(['previous']).optional(),
  })
  .strict()
  .refine((v) => (v.from === undefined) === (v.to === undefined), { message: vmsg('validation.startAndEndProvidedTogether'), path: ['from'] })
  .refine((v) => v.from === undefined || v.to === undefined || Date.parse(v.from) < Date.parse(v.to), {
    message: vmsg('validation.startBeforeEnd'),
    path: ['from'],
  })
  .refine((v) => v.from === undefined || v.to === undefined || (Date.parse(v.to) - Date.parse(v.from)) / DAY_MS <= DASHBOARD_MAX_RANGE_DAYS, {
    message: vmsg('validation.maxRangeDays', { days: DASHBOARD_MAX_RANGE_DAYS }),
    path: ['to'],
  });
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

/** The period of a request: the given from/to, or the last DASHBOARD_DEFAULT_RANGE_DAYS days ending at `now`. */
export function resolveDashboardRange(query: Pick<DashboardQuery, 'from' | 'to'>, now: Date): { from: Date; to: Date } {
  if (query.from !== undefined && query.to !== undefined) return { from: new Date(query.from), to: new Date(query.to) };
  return { from: new Date(now.getTime() - DASHBOARD_DEFAULT_RANGE_DAYS * DAY_MS), to: now };
}

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const DashboardRatioSchema = z.number().nullable();
/** One per-currency ratio (return on ad spend); null when the currency has no spend. */
export const CurrencyRatioSchema = z.object({ currency: CurrencyCodeSchema, value: DashboardRatioSchema }).strict();
export type CurrencyRatio = z.infer<typeof CurrencyRatioSchema>;

const MoneyListSchema = z.array(MoneySchema);

/** Same shape as FunnelStepStatDTO; the step key is a conversion event type, `visit` or `stage:<pipeline stage key>`. */
export const DashboardFunnelStepSchema = z
  .object({
    key: z.string().min(1).max(60),
    reached: z.number().int().min(0),
    rateFromPrevious: DashboardRatioSchema,
    rateFromFirst: DashboardRatioSchema,
    medianSecondsFromPrevious: z.number().nullable(),
  })
  .strict();
export type DashboardFunnelStep = z.infer<typeof DashboardFunnelStepSchema>;

export const DashboardFunnelSchema = z
  .object({ id: z.string(), windowDays: z.number().int().nullable(), steps: z.array(DashboardFunnelStepSchema) })
  .strict();

export const DashboardAcquisitionSchema = z
  .object({
    /** Leads (`lead` conversions) in the period. */
    leads: z.number().int().min(0),
    /** Newly paying studios (`studio_paid` conversions) in the period. */
    studioPaid: z.number().int().min(0),
    /** Ad spend of the period per currency (campaign level, so a campaign is not counted again through its ad sets). */
    spend: MoneyListSchema,
    /** Value of the `studio_paid` conversions per currency. */
    revenue: MoneyListSchema,
    /** Customer acquisition cost per currency: spend divided by studioPaid; a currency without spend or without a paid studio is left out. */
    cac: MoneyListSchema,
    /** Cost per lead per currency. */
    cpl: MoneyListSchema,
    /** Revenue divided by spend, per currency that had spend. */
    roas: z.array(CurrencyRatioSchema),
  })
  .strict();
export type DashboardAcquisition = z.infer<typeof DashboardAcquisitionSchema>;

export const DashboardTrialSchema = z
  .object({
    /** Studios whose trial started in the period. */
    trials: z.number().int().min(0),
    /** Of those, studios that have paid since. */
    converted: z.number().int().min(0),
    rate: DashboardRatioSchema,
    /** Median seconds from trial start to first payment among the converted. */
    medianSeconds: z.number().nullable(),
  })
  .strict();
export type DashboardTrial = z.infer<typeof DashboardTrialSchema>;

export const DashboardChannelRowSchema = z
  .object({
    /** Source name (`meta`), campaign id, or the placeholders `(direct)` / `(none)`. Tenant data, shown as is. */
    key: z.string(),
    /** Human-readable campaign name when the ad sync knows it. */
    label: z.string().nullable(),
    studioPaid: z.number().min(0),
    spend: MoneyListSchema,
    revenue: MoneyListSchema,
    roas: z.array(CurrencyRatioSchema),
  })
  .strict();
export type DashboardChannelRow = z.infer<typeof DashboardChannelRowSchema>;

export const DashboardBlockSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    funnel: DashboardFunnelSchema,
    acquisition: DashboardAcquisitionSchema,
    trial: DashboardTrialSchema,
    channels: z.object({ bySource: z.array(DashboardChannelRowSchema), byCampaign: z.array(DashboardChannelRowSchema) }).strict(),
  })
  .strict();
export type DashboardBlock = z.infer<typeof DashboardBlockSchema>;

const KpiComparisonSchema = z
  .object({
    current: z.number(),
    previous: z.number(),
    changeRatio: z.number().nullable(),
    direction: z.enum(['up', 'down', 'neutral']),
  })
  .strict();

export const CurrencyComparisonSchema = z
  .object({
    currency: CurrencyCodeSchema,
    current: z.number().nullable(),
    previous: z.number().nullable(),
    changeRatio: z.number().nullable(),
    direction: z.enum(['up', 'down', 'neutral']),
  })
  .strict();
export type CurrencyComparison = z.infer<typeof CurrencyComparisonSchema>;

export const DashboardDeltasSchema = z
  .object({
    funnel: z.array(z.object({ key: z.string(), reached: KpiComparisonSchema, rateFromFirstDelta: z.number().nullable() }).strict()),
    leads: KpiComparisonSchema,
    studioPaid: KpiComparisonSchema,
    spend: z.array(CurrencyComparisonSchema),
    revenue: z.array(CurrencyComparisonSchema),
    cac: z.array(CurrencyComparisonSchema),
    cpl: z.array(CurrencyComparisonSchema),
    roas: z.array(CurrencyComparisonSchema),
    trials: KpiComparisonSchema,
    converted: KpiComparisonSchema,
    /** Change of the trial to paid rate as a fraction (0.05 = +5 points); null when either side has no rate. */
    trialRateDelta: z.number().nullable(),
  })
  .strict();
export type DashboardDeltas = z.infer<typeof DashboardDeltasSchema>;

export const DashboardMrrSchema = z
  .object({
    /** Monthly list price of the studios that pay (activated), per currency. */
    activeMrr: MoneyListSchema,
    /** Monthly list price of the studios that started paying in the period, per currency. */
    newMrr: MoneyListSchema,
    newPayingStudios: z.number().int().min(0),
    /** Paying studios whose plan has no price in their billing currency; they are left out of the sums. */
    unpricedStudios: z.number().int().min(0),
  })
  .strict();
export type DashboardMrr = z.infer<typeof DashboardMrrSchema>;

export const EmailHealthWindowSchema = z
  .object({
    days: z.number().int(),
    /** E-mails the provider accepted (sent, delivered, bounced or complained); failed and pending ones are not counted. */
    sent: z.number().int().min(0),
    bounced: z.number().int().min(0),
    complained: z.number().int().min(0),
    bounceRate: DashboardRatioSchema,
    complaintRate: DashboardRatioSchema,
    bounceWarning: z.boolean(),
    complaintWarning: z.boolean(),
  })
  .strict();
export type EmailHealthWindow = z.infer<typeof EmailHealthWindowSchema>;

export const SmsHealthWindowSchema = z
  .object({
    days: z.number().int(),
    /** SMS attempts that left the queue (not pending). */
    attempted: z.number().int().min(0),
    delivered: z.number().int().min(0),
    deliveryRate: DashboardRatioSchema,
  })
  .strict();
export type SmsHealthWindow = z.infer<typeof SmsHealthWindowSchema>;

export const AI_BUDGET_LEVELS = ['ok', 'warning', 'exceeded'] as const;
export type AiBudgetLevel = (typeof AI_BUDGET_LEVELS)[number];

/** M5: a monthly cap row of the dashboard: the status, whether auto-pause is on, and the campaigns paused for it this month. */
export const AdSpendCapHealthSchema = AdSpendCapStatusSchema.extend({
  autoPause: z.boolean(),
  pauses: z.array(AdCapPauseSchema).max(100),
});
export type AdSpendCapHealth = z.infer<typeof AdSpendCapHealthSchema>;

export const DashboardHealthSchema = z
  .object({
    email: z.array(EmailHealthWindowSchema),
    sms: z.array(SmsHealthWindowSchema),
    ai: z
      .object({
        budgetCents: z.number().int().min(0),
        usedMicroUsd: z.number().min(0),
        /** used / budget; null when the budget is 0 (marketing AI switched off). */
        usedRatio: DashboardRatioSchema,
        level: z.enum(AI_BUDGET_LEVELS),
      })
      .strict(),
    approvals: z.object({ available: z.boolean(), pending: z.number().int().min(0) }).strict(),
    /** M3d: today's (UTC) sends against the daily caps. */
    caps: z
      .object({
        email: z
          .object({
            sent: z.number().int().min(0),
            /** The effective cap of today (the warm-up plan's when it is lower); null: no cap. */
            cap: z.number().int().min(0).nullable(),
            source: z.enum(['NONE', 'CONFIGURED', 'WARMUP']),
            warmupDay: z.number().int().min(1).nullable(),
          })
          .strict(),
        sms: z.object({ credits: z.number().int().min(0), cap: z.number().int().min(0).nullable() }).strict(),
        /** Recipients waiting for the next day because a cap was reached. */
        deferredRecipients: z.number().int().min(0),
      })
      .strict(),
    /** M3d: the e-mail deliverability fuse. */
    autoPause: z
      .object({
        /** At least one e-mail campaign is paused by the system. */
        active: z.boolean(),
        pausedCampaigns: z.number().int().min(0),
        reasons: z.array(z.enum(FUSE_REASONS)),
      })
      .strict(),
    /** M3d: month-to-date ad spend against the monthly caps, per currency (only currencies with a cap). */
    adSpendCaps: z.array(AdSpendCapHealthSchema),
    connections: z
      .object({
        errorCount: z.number().int().min(0),
        items: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                platform: z.string(),
                label: z.string(),
                status: z.string(),
                lastError: z.string(),
                lastSyncAt: z.string().datetime().nullable(),
              })
              .strict(),
          )
          .max(50),
        /** Conversion deliveries that ended as FAILED, created in the period. */
        failedDeliveries: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
export type DashboardHealth = z.infer<typeof DashboardHealthSchema>;

export const MarketingDashboardSchema = z
  .object({
    generatedAt: z.string().datetime(),
    current: DashboardBlockSchema,
    /** Only with `compare=previous`. */
    previous: DashboardBlockSchema.nullable(),
    deltas: DashboardDeltasSchema.nullable(),
    /** Present only for a caller with platform.referrals.view (or the super admin); omitted otherwise. */
    mrr: DashboardMrrSchema.optional(),
    health: DashboardHealthSchema,
  })
  .strict();
export type MarketingDashboardDTO = z.infer<typeof MarketingDashboardSchema>;

// ---------------------------------------------------------------------------
// KPI math (pure)
// ---------------------------------------------------------------------------

function toNumber(amount: string): number {
  return Number(amount);
}

function fixed(value: number): string {
  return value.toFixed(2);
}

const SECRET_PARAM_RE = /\b(access_token|refresh_token|token|api[_-]?key|key|secret|password|authorization)(\s*[=:]\s*)[A-Za-z0-9._~+/=-]{16,}/gi;
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** A stored connection error made safe for the dashboard: contact details and token-like values masked, then cut to DASHBOARD_ERROR_TEXT_MAX characters. */
export function sanitizeConnectionError(text: string): string {
  // Secrets first: redactPii would otherwise cut a token at its digit run and leave the rest visible.
  const masked = redactPii(text.replace(BEARER_RE, 'Bearer [hidden]').replace(SECRET_PARAM_RE, (_m, name: string) => `${name}=[hidden]`))
    .replace(/\s+/g, ' ')
    .trim();
  return masked.length > DASHBOARD_ERROR_TEXT_MAX ? `${masked.slice(0, DASHBOARD_ERROR_TEXT_MAX - 1)}\u2026` : masked;
}

/** Money list from a currency -> decimal string map, sorted by currency so responses are stable. */
export function moneyList(byCurrency: ReadonlyMap<string, string> | Readonly<Record<string, string>>): Money[] {
  const entries = byCurrency instanceof Map ? [...byCurrency.entries()] : Object.entries(byCurrency);
  return entries.map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Cost per acquisition per currency: `spend` divided by `count` with the
 * existing report math. A currency without spend, and every currency when
 * `count` is 0, is left out: there is no cost to show, and dividing by zero
 * never yields a number.
 */
export function costPerUnit(spend: readonly Money[], count: number, kind: 'cac' | 'cpl'): Money[] {
  const out: Money[] = [];
  for (const item of spend) {
    const unit = kind === 'cac' ? computeCac(toNumber(item.amount), count) : computeCpl(toNumber(item.amount), count);
    if (unit !== null) out.push({ currency: item.currency, amount: fixed(unit) });
  }
  return out.sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Return on ad spend per currency that had spend (revenue of the same currency, 0 when there is none). Currencies are never mixed. */
export function roasByCurrency(revenue: readonly Money[], spend: readonly Money[]): CurrencyRatio[] {
  const revenueOf = new Map(revenue.map((m) => [m.currency, toNumber(m.amount)]));
  return spend
    .map((s) => ({ currency: s.currency, value: computeRoas(revenueOf.get(s.currency) ?? 0, toNumber(s.amount)) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Money as plain per-currency numbers, for comparisons. */
export function moneyToRatios(list: readonly Money[]): CurrencyRatio[] {
  return list.map((m) => ({ currency: m.currency, value: toNumber(m.amount) }));
}

/**
 * Per-currency comparison of two periods. Every currency of either side
 * appears; a side without a value is null and yields no change ratio. A
 * previous value of 0 gives a neutral comparison without percentage.
 */
export function compareByCurrency(current: readonly CurrencyRatio[], previous: readonly CurrencyRatio[]): CurrencyComparison[] {
  const cur = new Map(current.map((r) => [r.currency, r.value]));
  const prev = new Map(previous.map((r) => [r.currency, r.value]));
  const currencies = [...new Set([...cur.keys(), ...prev.keys()])].sort();
  return currencies.map((currency) => {
    const a = cur.get(currency) ?? null;
    const b = prev.get(currency) ?? null;
    if (a === null || b === null) return { currency, current: a, previous: b, changeRatio: null, direction: 'neutral' as const };
    const cmp = compareKpi(a, b);
    return { currency, current: a, previous: b, changeRatio: cmp.changeRatio, direction: cmp.direction };
  });
}

/** Trial to paid summary of a cohort: studios whose trial started in the period, and when (if ever) they first paid. */
export function summarizeTrialCohort(rows: readonly { trialStartedAt: Date; activatedAt: Date | null }[]): DashboardTrial {
  const durations: number[] = [];
  let converted = 0;
  for (const row of rows) {
    if (row.activatedAt === null) continue;
    converted += 1;
    durations.push(Math.max(0, (row.activatedAt.getTime() - row.trialStartedAt.getTime()) / 1000));
  }
  return { trials: rows.length, converted, rate: rows.length === 0 ? null : converted / rows.length, medianSeconds: medianOf(durations) };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Bounce and complaint rates of one e-mail window with the warning flags (strictly above the thresholds). */
export function emailHealthOf(days: number, sent: number, bounced: number, complained: number): EmailHealthWindow {
  const bounceRate = rate(bounced, sent);
  const complaintRate = rate(complained, sent);
  return {
    days,
    sent,
    bounced,
    complained,
    bounceRate,
    complaintRate,
    bounceWarning: bounceRate !== null && bounceRate > EMAIL_BOUNCE_WARNING_RATE,
    complaintWarning: complaintRate !== null && complaintRate > EMAIL_COMPLAINT_WARNING_RATE,
  };
}

export function smsHealthOf(days: number, attempted: number, delivered: number): SmsHealthWindow {
  return { days, attempted, delivered, deliveryRate: rate(delivered, attempted) };
}

/** AI budget usage of the month: `budgetCents` 0 means the marketing AI is switched off (exceeded, no ratio). */
export function aiBudgetOf(budgetCents: number, usedMicroUsd: number): DashboardHealth['ai'] {
  const budgetMicroUsd = budgetCents * 10_000;
  const usedRatio = budgetMicroUsd > 0 ? usedMicroUsd / budgetMicroUsd : null;
  const level: AiBudgetLevel = budgetMicroUsd <= 0 || usedMicroUsd >= budgetMicroUsd ? 'exceeded' : usedRatio !== null && usedRatio >= AI_BUDGET_WARNING_RATIO ? 'warning' : 'ok';
  return { budgetCents, usedMicroUsd, usedRatio, level };
}

/** Deltas of the current block against the previous one. */
export function buildDashboardDeltas(current: DashboardBlock, previous: DashboardBlock): DashboardDeltas {
  const prevStep = new Map(previous.funnel.steps.map((s) => [s.key, s]));
  const a = current.acquisition;
  const b = previous.acquisition;
  return {
    funnel: current.funnel.steps.map((step) => {
      const prev = prevStep.get(step.key);
      const now = step.rateFromFirst;
      const before = prev?.rateFromFirst ?? null;
      return { key: step.key, reached: compareKpi(step.reached, prev?.reached ?? 0), rateFromFirstDelta: now === null || before === null ? null : now - before };
    }),
    leads: compareKpi(a.leads, b.leads),
    studioPaid: compareKpi(a.studioPaid, b.studioPaid),
    spend: compareByCurrency(moneyToRatios(a.spend), moneyToRatios(b.spend)),
    revenue: compareByCurrency(moneyToRatios(a.revenue), moneyToRatios(b.revenue)),
    cac: compareByCurrency(moneyToRatios(a.cac), moneyToRatios(b.cac)),
    cpl: compareByCurrency(moneyToRatios(a.cpl), moneyToRatios(b.cpl)),
    roas: compareByCurrency(a.roas, b.roas),
    trials: compareKpi(current.trial.trials, previous.trial.trials),
    converted: compareKpi(current.trial.converted, previous.trial.converted),
    trialRateDelta: current.trial.rate === null || previous.trial.rate === null ? null : current.trial.rate - previous.trial.rate,
  };
}

/** Conversion types the dashboard reads; kept next to the schema so a renamed event type breaks the build here. */
export const DASHBOARD_LEAD_EVENT = 'lead' as const satisfies (typeof CONVERSION_EVENT_TYPES)[number];
export const DASHBOARD_PAID_EVENT = 'studio_paid' as const satisfies (typeof CONVERSION_EVENT_TYPES)[number];
