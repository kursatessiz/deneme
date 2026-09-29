import { z } from 'zod';
import { funnelStepMessageKey } from '../funnels';
import type { Translate } from '../i18n/translator';
import { compareKpi } from '../report-compare';
import type { DashboardBlock } from './dashboard';
import { MARKETING_MIN_CELL } from './privacy';

/**
 * Weekly marketing summary (M3d, docs/PAZARLAMA_MODULU.md 3.3, 7.4): the
 * aggregate KPIs of one ISO week against the week before, a short summary
 * and suggested actions. The KPIs are built from the dashboard numbers only:
 * counts of people below the k-anonymity minimum are hidden and so is every
 * figure that would let the hidden count be recovered (a cost per paid
 * studio, a return). Money always carries its currency and is never summed
 * across currencies.
 */

export const INSIGHT_ACTIONS_MIN = 3;
export const INSIGHT_ACTIONS_MAX = 5;
export const INSIGHT_SUMMARY_MAX = 1200;
export const INSIGHT_LIST_LIMIT_MAX = 52;

export const INSIGHT_UNITS = ['count', 'money', 'ratio', 'percent'] as const;
export type InsightUnit = (typeof INSIGHT_UNITS)[number];

export const InsightMetricSchema = z
  .object({
    /** `leads`, `spend`, `funnel.<step>`, ... ; money and return metrics are per currency, so the key carries the currency (`spend:USD`). */
    key: z.string().min(1).max(60),
    unit: z.enum(INSIGHT_UNITS),
    currency: z.string().length(3).nullable(),
    /** Null: no data, or hidden by k-anonymity. */
    current: z.number().nullable(),
    previous: z.number().nullable(),
    /** (current - previous) / previous; null without both values or with a previous value of 0. */
    changeRatio: z.number().nullable(),
  })
  .strict();
export type InsightMetric = z.infer<typeof InsightMetricSchema>;

export const InsightKpisSchema = z
  .object({
    /** ISO dates (YYYY-MM-DD), inclusive. */
    period: z.object({ from: z.string(), to: z.string() }).strict(),
    previousPeriod: z.object({ from: z.string(), to: z.string() }).strict(),
    /** The smallest count of people that is shown. */
    minCell: z.number().int(),
    metrics: z.array(InsightMetricSchema).max(80),
  })
  .strict();
export type InsightKpis = z.infer<typeof InsightKpisSchema>;

export const InsightActionSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    detail: z.string().trim().min(1).max(400),
    /** The metric the suggestion rests on (a `key` of the KPIs). */
    kpiKey: z.string().min(1).max(60),
  })
  .strict();
export type InsightAction = z.infer<typeof InsightActionSchema>;

export interface MarketingInsightDTO {
  id: string;
  /** ISO date (YYYY-MM-DD) of the Monday of the summarised week. */
  periodStart: string;
  /** ISO date (YYYY-MM-DD) of the Sunday of the summarised week. */
  periodEnd: string;
  kpis: InsightKpis;
  summary: string;
  actions: InsightAction[];
  createdAt: string;
}

export const InsightListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(INSIGHT_LIST_LIMIT_MAX).default(12),
  })
  .strict();
export type InsightListQuery = z.infer<typeof InsightListQuerySchema>;

export interface InsightListDTO {
  items: MarketingInsightDTO[];
}

/** POST /admin/marketing/insights/generate: `force` replaces the week's insight, `notify` also e-mails the weekly summary recipients (testing). */
export const GenerateInsightSchema = z
  .object({
    /** Any instant inside the week after the one to summarise; defaults to now. */
    at: z.string().datetime().optional(),
    force: z.boolean().default(false),
    notify: z.boolean().default(false),
  })
  .strict();
export type GenerateInsightInput = z.infer<typeof GenerateInsightSchema>;

export interface GenerateInsightResultDTO {
  /** False when the week already had an insight (and `force` was not set). */
  created: boolean;
  insight: MarketingInsightDTO;
}

// ---------------------------------------------------------------------------
// KPI builder (pure)
// ---------------------------------------------------------------------------

function metric(key: string, unit: InsightUnit, currency: string | null, current: number | null, previous: number | null): InsightMetric {
  const changeRatio = current !== null && previous !== null ? compareKpi(current, previous).changeRatio : null;
  return { key, unit, currency, current, previous, changeRatio };
}

/** A count of people: hidden below the minimum cell size. */
function shownCount(value: number, k: number): number | null {
  return value >= k ? value : null;
}

function perCurrency(
  keyPrefix: string,
  unit: InsightUnit,
  current: ReadonlyArray<{ currency: string; value: number }>,
  previous: ReadonlyArray<{ currency: string; value: number }>,
): InsightMetric[] {
  const cur = new Map(current.map((r) => [r.currency, r.value]));
  const prev = new Map(previous.map((r) => [r.currency, r.value]));
  return [...new Set([...cur.keys(), ...prev.keys()])].sort().map((currency) => metric(`${keyPrefix}:${currency}`, unit, currency, cur.get(currency) ?? null, prev.get(currency) ?? null));
}

const moneyValues = (list: readonly { amount: string; currency: string }[]) => list.map((m) => ({ currency: m.currency, value: Number(m.amount) }));

/**
 * The KPI set of a week: funnel steps, leads, paid studios, trials, trial to
 * paid rate, and per currency spend, revenue, cost per paid studio, cost per
 * lead and return on ad spend. Anything derived from a count of people below
 * `k` is null on that side (spend is not person data and stays visible).
 */
export function buildInsightKpis(
  current: DashboardBlock,
  previous: DashboardBlock,
  period: { from: string; to: string },
  previousPeriod: { from: string; to: string },
  k: number = MARKETING_MIN_CELL,
): InsightKpis {
  const a = current.acquisition;
  const b = previous.acquisition;
  const metrics: InsightMetric[] = [];

  const prevStep = new Map(previous.funnel.steps.map((s) => [s.key, s.reached]));
  for (const step of current.funnel.steps) {
    metrics.push(metric(`funnel.${step.key}`, 'count', null, shownCount(step.reached, k), shownCount(prevStep.get(step.key) ?? 0, k)));
  }
  metrics.push(metric('leads', 'count', null, shownCount(a.leads, k), shownCount(b.leads, k)));
  metrics.push(metric('studioPaid', 'count', null, shownCount(a.studioPaid, k), shownCount(b.studioPaid, k)));
  metrics.push(metric('trials', 'count', null, shownCount(current.trial.trials, k), shownCount(previous.trial.trials, k)));
  metrics.push(metric('converted', 'count', null, shownCount(current.trial.converted, k), shownCount(previous.trial.converted, k)));
  metrics.push(
    metric(
      'trialRate',
      'percent',
      null,
      current.trial.trials >= k ? current.trial.rate : null,
      previous.trial.trials >= k ? previous.trial.rate : null,
    ),
  );

  metrics.push(...perCurrency('spend', 'money', moneyValues(a.spend), moneyValues(b.spend)));
  // Revenue, cost and return depend on how many studios paid or leads came in: hidden together with that count.
  const gate = (list: { currency: string; value: number }[], visible: boolean) => (visible ? list : []);
  const paidShown = { cur: a.studioPaid >= k, prev: b.studioPaid >= k };
  const leadsShown = { cur: a.leads >= k, prev: b.leads >= k };
  const pair = (
    prefix: string,
    unit: InsightUnit,
    cur: { currency: string; value: number }[],
    prev: { currency: string; value: number }[],
    shown: { cur: boolean; prev: boolean },
  ) => perCurrency(prefix, unit, gate(cur, shown.cur), gate(prev, shown.prev));
  metrics.push(...pair('revenue', 'money', moneyValues(a.revenue), moneyValues(b.revenue), paidShown));
  metrics.push(...pair('cac', 'money', moneyValues(a.cac), moneyValues(b.cac), paidShown));
  metrics.push(...pair('cpl', 'money', moneyValues(a.cpl), moneyValues(b.cpl), leadsShown));
  metrics.push(
    ...pair(
      'roas',
      'ratio',
      a.roas.flatMap((r) => (r.value === null ? [] : [{ currency: r.currency, value: r.value }])),
      b.roas.flatMap((r) => (r.value === null ? [] : [{ currency: r.currency, value: r.value }])),
      paidShown,
    ),
  );

  return { period, previousPeriod, minCell: k, metrics };
}

/** Keys an action may cite. */
export function insightMetricKeys(kpis: InsightKpis): string[] {
  return kpis.metrics.map((m) => m.key);
}

/** True when the week has at least one visible number to talk about (otherwise there is nothing to summarise). */
export function insightHasSignal(kpis: InsightKpis): boolean {
  return kpis.metrics.some((m) => m.current !== null || m.previous !== null);
}

// ---------------------------------------------------------------------------
// Formatting (shared by the weekly e-mail and the dashboard panel)
// ---------------------------------------------------------------------------

/** The part of a metric key before the currency (`spend:USD` -> `spend`). */
export function insightMetricBase(key: string): string {
  const at = key.indexOf(':');
  return at === -1 ? key : key.slice(0, at);
}

/** Human label of a metric; per-currency ones carry the currency code. Funnel steps use the funnel step names. */
export function insightMetricLabel(metric: InsightMetric, t: Translate): string {
  const base = insightMetricBase(metric.key);
  const label = base.startsWith('funnel.') ? t(funnelStepMessageKey(base.slice('funnel.'.length))) : t(`marketingInsights.metric.${base}`);
  return metric.currency ? `${label} (${metric.currency})` : label;
}

/** One value of a metric in the viewer's locale (money with its own currency, never a fixed one). */
export function formatInsightValue(metric: InsightMetric, value: number | null, locale: string, hidden: string): string {
  if (value === null) return hidden;
  try {
    switch (metric.unit) {
      case 'money':
        return metric.currency ? new Intl.NumberFormat(locale, { style: 'currency', currency: metric.currency }).format(value) : new Intl.NumberFormat(locale).format(value);
      case 'percent':
        return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
      case 'ratio':
        return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
      default:
        return new Intl.NumberFormat(locale).format(value);
    }
  } catch {
    return String(value);
  }
}

/** Signed percent change ("+12.5 %"), or null without one. */
export function formatInsightChange(changeRatio: number | null, locale: string): string | null {
  if (changeRatio === null) return null;
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(changeRatio);
}

/** "Label: value (change)" of a metric, or null when neither week has a visible value. */
export function insightMetricLine(metric: InsightMetric, t: Translate, locale: string, minCell: number): string | null {
  if (metric.current === null && metric.previous === null) return null;
  const hidden = t('marketingInsights.hidden', { min: minCell });
  const value = formatInsightValue(metric, metric.current, locale, hidden);
  const change = formatInsightChange(metric.changeRatio, locale);
  return `${insightMetricLabel(metric, t)}: ${value}${change ? ` (${change})` : ''}`;
}
