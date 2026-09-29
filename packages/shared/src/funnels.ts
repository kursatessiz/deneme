import { z } from 'zod';
import { CONVERSION_EVENT_TYPES } from './growth/conversions';
import type { ConversionEventType } from './growth/conversions';
import { ATTRIBUTION_DIRECT, ATTRIBUTION_NONE } from './crm';
import { compareKpi } from './report-compare';
import type { KpiComparison } from './report-compare';

/**
 * Conversion funnels (G5d-1, docs/HUNILER.md). A funnel is an ordered list of
 * steps; a contact "reaches" step k when it has an event of that step at or
 * after the moment it reached step k-1 (and, with a window, within that many
 * days of it). Ready-made funnels are code, tenant funnels are rows; the
 * counting itself runs in SQL in apps/api and follows exactly the rules of
 * `resolveFunnelPath` below, which the unit tests and the API e2e pin down.
 */

export const FUNNEL_MIN_STEPS = 2;
export const FUNNEL_MAX_STEPS = 6;
export const FUNNEL_MAX_WINDOW_DAYS = 365;
/** Maximum number of breakdown rows returned by a report. */
export const FUNNEL_MAX_GROUPS = 100;

/** Pseudo step for the visitor -> lead -> member funnel: the contact's first tracked touchpoint. Never a ConversionEvent. */
export const FUNNEL_VISIT_STEP = 'visit';
export const FUNNEL_STEP_KEYS = [...CONVERSION_EVENT_TYPES, FUNNEL_VISIT_STEP] as const;
export type FunnelStepKey = ConversionEventType | typeof FUNNEL_VISIT_STEP;

export const FUNNEL_BREAKDOWNS = ['source', 'campaign', 'branch'] as const;
export type FunnelBreakdown = (typeof FUNNEL_BREAKDOWNS)[number];

/** Tenant funnel steps: 2-6 distinct ConversionEvent types (the visit pseudo step is ready-made only). */
export const TenantFunnelStepsSchema = z
  .array(z.enum(CONVERSION_EVENT_TYPES))
  .min(FUNNEL_MIN_STEPS, `En az ${FUNNEL_MIN_STEPS} adım gerekir`)
  .max(FUNNEL_MAX_STEPS, `En fazla ${FUNNEL_MAX_STEPS} adım olabilir`)
  .refine((steps) => new Set(steps).size === steps.length, { message: 'Bir adım türü yalnızca bir kez kullanılabilir' });

const FunnelWindowSchema = z.number().int().min(1).max(FUNNEL_MAX_WINDOW_DAYS);

export const CreateFunnelSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    steps: TenantFunnelStepsSchema,
    windowDays: FunnelWindowSchema.nullable().default(null),
  })
  .strict();
export type CreateFunnelInput = z.infer<typeof CreateFunnelSchema>;

export const UpdateFunnelSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    steps: TenantFunnelStepsSchema.optional(),
    windowDays: FunnelWindowSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gerekir' });
export type UpdateFunnelInput = z.infer<typeof UpdateFunnelSchema>;

/** Extra query of the report endpoint, next to the shared ReportRangeSchema (from, to). */
export const FunnelReportQuerySchema = z.object({
  breakdown: z.enum(FUNNEL_BREAKDOWNS).optional(),
  compare: z.enum(['previous']).optional(),
  branchId: z.string().uuid().optional(),
});
export type FunnelReportQuery = z.infer<typeof FunnelReportQuerySchema>;

// ---------------------------------------------------------------------------
// Ready-made funnels (code, not rows)
// ---------------------------------------------------------------------------

export interface ReadyMadeFunnel {
  /** Route id: `ready:<slug>`. */
  id: string;
  slug: string;
  steps: readonly FunnelStepKey[];
  windowDays: number | null;
  /** True when the first step comes from the tracked website visits (needs site tracking). */
  requiresSiteTracking: boolean;
}

export const READY_MADE_FUNNEL_PREFIX = 'ready:';

export const READY_MADE_FUNNELS: readonly ReadyMadeFunnel[] = [
  {
    id: `${READY_MADE_FUNNEL_PREFIX}lead-to-member`,
    slug: 'lead-to-member',
    steps: ['lead', 'trial_booked', 'trial_attended', 'purchase'],
    windowDays: null,
    requiresSiteTracking: false,
  },
  {
    id: `${READY_MADE_FUNNEL_PREFIX}trial-to-member`,
    slug: 'trial-to-member',
    steps: ['trial_booked', 'purchase'],
    windowDays: null,
    requiresSiteTracking: false,
  },
  {
    id: `${READY_MADE_FUNNEL_PREFIX}visitor-to-member`,
    slug: 'visitor-to-member',
    steps: [FUNNEL_VISIT_STEP, 'lead', 'purchase'],
    windowDays: null,
    requiresSiteTracking: true,
  },
];

export function findReadyMadeFunnel(id: string): ReadyMadeFunnel | undefined {
  return READY_MADE_FUNNELS.find((f) => f.id === id);
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface FunnelSummaryDTO {
  id: string;
  kind: 'READY_MADE' | 'TENANT';
  /** Tenant funnels: the tenant's own name. Ready-made funnels: null (the client translates `funnels.ready.<slug>`). */
  name: string | null;
  slug: string | null;
  steps: FunnelStepKey[];
  windowDays: number | null;
  requiresSiteTracking: boolean;
  createdAt: string | null;
}

export interface FunnelStepStatDTO {
  key: FunnelStepKey;
  /** Contacts that reached this step in order (and within the window). */
  reached: number;
  /** reached / previous step's reached; null for the first step or when the previous step is 0. */
  rateFromPrevious: number | null;
  /** reached / first step's reached; null when nobody entered. */
  rateFromFirst: number | null;
  /** Median seconds from the previous step to this one among contacts that reached it; null for the first step or with no data. */
  medianSecondsFromPrevious: number | null;
}

export interface FunnelGroupDTO {
  key: string;
  label: string | null;
  steps: FunnelStepStatDTO[];
}

export interface FunnelReportDTO {
  funnel: FunnelSummaryDTO;
  from: string;
  to: string;
  breakdown: FunnelBreakdown | null;
  steps: FunnelStepStatDTO[];
  /** Per-group rows of the requested breakdown, biggest entry first; empty without a breakdown. */
  groups: FunnelGroupDTO[];
  /** The same funnel over the previous same-length window; null unless `compare=previous`. */
  previous: { from: string; to: string; steps: FunnelStepStatDTO[] } | null;
}

/** Placeholder group keys, shared with the attribution report. */
export const FUNNEL_GROUP_DIRECT = ATTRIBUTION_DIRECT;
export const FUNNEL_GROUP_NONE = ATTRIBUTION_NONE;

// ---------------------------------------------------------------------------
// Pure computation
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Median with linear interpolation between the two middle values (same as SQL percentile_cont(0.5)); null for no values. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  if (Number.isInteger(mid)) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[Math.floor(mid)];
}

export interface FunnelEventLike {
  step: FunnelStepKey;
  /** Epoch milliseconds. */
  at: number;
}

/**
 * The moment (epoch ms) a single contact reached each step, or null from the
 * first step it did not reach. Step 1 is the contact's earliest event of that
 * step. Every later step is the earliest event of that step at or after the
 * previous step's moment and, when `windowDays` is set, no later than that
 * many days after it. Events out of order (before the previous step) never
 * count.
 */
export function resolveFunnelPath(events: readonly FunnelEventLike[], steps: readonly FunnelStepKey[], windowDays: number | null): (number | null)[] {
  const path: (number | null)[] = [];
  let previous: number | null = null;
  steps.forEach((step, index) => {
    let found: number | null = null;
    if (index === 0 || previous !== null) {
      for (const e of events) {
        if (e.step !== step) continue;
        if (index > 0 && previous !== null) {
          if (e.at < previous) continue;
          if (windowDays !== null && e.at - previous > windowDays * DAY_MS) continue;
        }
        if (found === null || e.at < found) found = e.at;
      }
    }
    path.push(found);
    previous = found;
  });
  return path;
}

export interface FunnelAggregate {
  /** Per step: contacts that reached it. */
  counts: number[];
  /** Per step: median seconds from the previous step; null for the first step or with no data. */
  medianSeconds: (number | null)[];
}

/**
 * Reference aggregation over per-contact paths: entry = the first step
 * happened inside [from, to] (epoch ms, inclusive). The API computes the
 * same numbers in SQL; this is the specification both are tested against.
 */
export function aggregateFunnelPaths(paths: readonly (readonly (number | null)[])[], stepCount: number, range: { from: number; to: number }): FunnelAggregate {
  const entered = paths.filter((p) => {
    const first = p[0];
    return first !== null && first !== undefined && first >= range.from && first <= range.to;
  });
  const counts: number[] = [];
  const medianSeconds: (number | null)[] = [];
  for (let k = 0; k < stepCount; k++) {
    const deltas: number[] = [];
    let reached = 0;
    for (const p of entered) {
      const at = p[k];
      if (at === null || at === undefined) continue;
      reached += 1;
      const before = k > 0 ? p[k - 1] : null;
      if (before !== null && before !== undefined) deltas.push((at - before) / 1000);
    }
    counts.push(reached);
    medianSeconds.push(k === 0 ? null : medianOf(deltas));
  }
  return { counts, medianSeconds };
}

/** Turns per-step counts and medians into the rates the report shows. */
export function buildFunnelSteps(steps: readonly FunnelStepKey[], aggregate: FunnelAggregate): FunnelStepStatDTO[] {
  const first = aggregate.counts[0] ?? 0;
  return steps.map((key, k) => {
    const reached = aggregate.counts[k] ?? 0;
    const previous = k === 0 ? 0 : (aggregate.counts[k - 1] ?? 0);
    return {
      key,
      reached,
      rateFromPrevious: k === 0 || previous === 0 ? null : reached / previous,
      rateFromFirst: first === 0 ? null : reached / first,
      medianSecondsFromPrevious: k === 0 ? null : (aggregate.medianSeconds[k] ?? null),
    };
  });
}

export interface FunnelStepComparison {
  key: FunnelStepKey;
  reached: KpiComparison;
  /** Change of the conversion rate from the first step as a fraction (0.05 = +5 points); null when either side has no rate. */
  rateFromFirstDelta: number | null;
}

/** Step-by-step comparison of the current period with the previous one (same step list). */
export function compareFunnelSteps(current: readonly FunnelStepStatDTO[], previous: readonly FunnelStepStatDTO[]): FunnelStepComparison[] {
  return current.map((step, k) => {
    const prev = previous[k];
    const a = step.rateFromFirst;
    const b = prev?.rateFromFirst ?? null;
    return {
      key: step.key,
      reached: compareKpi(step.reached, prev?.reached ?? 0),
      rateFromFirstDelta: a === null || b === null ? null : a - b,
    };
  });
}

/** Picks the display unit of a median duration: minutes below an hour, hours below a day, days above. */
export function pickDurationUnit(seconds: number): { unit: 'minute' | 'hour' | 'day'; value: number } {
  if (seconds < 3600) return { unit: 'minute', value: Math.max(0, Math.round(seconds / 60)) };
  if (seconds < 86400) return { unit: 'hour', value: Math.round((seconds / 3600) * 10) / 10 };
  return { unit: 'day', value: Math.round((seconds / 86400) * 10) / 10 };
}
