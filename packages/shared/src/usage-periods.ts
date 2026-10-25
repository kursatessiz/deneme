import { z } from 'zod';
import type { ValidationKey } from './validation-key';
import { vmsg } from './validation-key';
import { partsInZone, safeZone, zoneOffsetMs } from './dashboard/periods';

/**
 * Usage periods (docs/KULLANIM_DONEMLERI.md): a package's rights are split into
 * periods (month, week or a number of days) counted from the package start. Each
 * tier carries its own quota and either burns the unused part at period end or
 * only caps usage. Everything in this file is pure: the API enforces and burns,
 * the web and mobile screens render the same rule and period status.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const USAGE_TIER_UNITS = ['MONTH', 'WEEK', 'DAYS'] as const;
export type UsageTierUnit = (typeof USAGE_TIER_UNITS)[number];

export const USAGE_MONTH_MODES = ['CALENDAR', 'FIXED_DAYS'] as const;
export type UsageMonthMode = (typeof USAGE_MONTH_MODES)[number];

export const USAGE_REMINDER_MAX_DAYS = 14;
export const USAGE_REMINDER_DEFAULT_DAYS = 3;
/** Template key of the member reminder sent before a burning period ends (tr and en in the msgTpl namespace). */
export const USAGE_PERIOD_REMINDER_TEMPLATE_KEY = 'USAGE_PERIOD_EXPIRY_REMINDER';

const LENGTH_RANGE: Record<UsageTierUnit, { min: number; max: number }> = {
  MONTH: { min: 1, max: 12 },
  WEEK: { min: 1, max: 8 },
  DAYS: { min: 1, max: 366 },
};

const UsageTierBaseSchema = z.object({
  unit: z.enum(USAGE_TIER_UNITS),
  length: z.number().int(),
  monthMode: z.enum(USAGE_MONTH_MODES).optional(),
  fixedMonthDays: z.union([z.literal(30), z.literal(31)]).optional(),
  /** Units (sessions), credits or visits (unlimited packages) usable inside one period. */
  quota: z.number().int().min(1, vmsg('validation.usageQuotaAtLeastOne')),
  /** True: the unused quota burns at period end. False: the tier only caps usage. */
  expireUnused: z.boolean(),
});

export const UsageTierSchema = UsageTierBaseSchema.superRefine((tier, ctx) => {
  const range = LENGTH_RANGE[tier.unit];
  if (tier.length < range.min || tier.length > range.max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['length'], message: vmsg('validation.usageTierLengthOutOfRange', range) });
  }
  if (tier.unit === 'MONTH') {
    if (!tier.monthMode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['monthMode'], message: vmsg('validation.usageMonthModeRequired') });
    } else if (tier.monthMode === 'FIXED_DAYS' && tier.fixedMonthDays === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fixedMonthDays'], message: vmsg('validation.usageFixedMonthDaysRequired') });
    } else if (tier.monthMode === 'CALENDAR' && tier.fixedMonthDays !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fixedMonthDays'], message: vmsg('validation.usageFixedMonthDaysOnlyFixed') });
    }
  } else if (tier.monthMode !== undefined || tier.fixedMonthDays !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['monthMode'], message: vmsg('validation.usageMonthModeOnlyMonth') });
  }
});
export type UsageTier = z.infer<typeof UsageTierSchema>;

/** Nominal length of a tier in days, only used to order tiers (a month counts 30 days, whatever its mode). */
export function tierNominalDays(tier: Pick<UsageTier, 'unit' | 'length' | 'monthMode' | 'fixedMonthDays'>): number {
  switch (tier.unit) {
    case 'DAYS':
      return tier.length;
    case 'WEEK':
      return tier.length * 7;
    case 'MONTH':
      return tier.monthMode === 'FIXED_DAYS' && tier.fixedMonthDays ? tier.length * tier.fixedMonthDays : tier.length * 30;
  }
}

/** Tiers ordered from the shortest period to the longest. */
export function sortTiersFinerFirst<T extends Pick<UsageTier, 'unit' | 'length' | 'monthMode' | 'fixedMonthDays'>>(tiers: readonly T[]): T[] {
  return [...tiers].sort((a, b) => tierNominalDays(a) - tierNominalDays(b));
}

export const UsageRuleSchema = z
  .object({
    version: z.literal(1),
    tiers: z.array(UsageTierSchema).min(1, vmsg('validation.usageTiersCount')).max(2, vmsg('validation.usageTiersCount')),
    reminderDaysBefore: z
      .number()
      .int()
      .min(0, vmsg('validation.usageReminderDaysRange', { max: USAGE_REMINDER_MAX_DAYS }))
      .max(USAGE_REMINDER_MAX_DAYS, vmsg('validation.usageReminderDaysRange', { max: USAGE_REMINDER_MAX_DAYS }))
      .default(USAGE_REMINDER_DEFAULT_DAYS),
  })
  .superRefine((rule, ctx) => {
    if (rule.tiers.length < 2) return;
    const [a, b] = rule.tiers;
    if (a.unit === b.unit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tiers'], message: vmsg('validation.usageTiersDistinctUnits') });
      return;
    }
    const [finer, coarser] = sortTiersFinerFirst(rule.tiers);
    if (tierNominalDays(finer) >= tierNominalDays(coarser)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tiers'], message: vmsg('validation.usageTiersOrder') });
      return;
    }
    if (finer.quota > coarser.quota) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tiers'], message: vmsg('validation.usageFinerQuotaTooHigh') });
    }
  });
export type UsageRule = z.infer<typeof UsageRuleSchema>;
export type UsageRuleInput = z.input<typeof UsageRuleSchema>;

/**
 * Package-kind specific rule check: an unlimited package has no units to burn, so its tiers can only
 * cap visits. Returns the validation key of the problem, or null when the rule fits the kind.
 */
export function usageRuleKindIssue(rule: UsageRule, entitlementKind: string): ValidationKey | null {
  if (entitlementKind === 'TIME_UNLIMITED' && rule.tiers.some((t) => t.expireUnused)) return 'validation.usageUnlimitedCannotExpire';
  return null;
}

/** Parses a stored JSON value; null when it is absent or no longer valid (a bad row never blocks booking). */
export function parseUsageRule(value: unknown): UsageRule | null {
  if (value === null || value === undefined) return null;
  const parsed = UsageRuleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** True when any tier burns unused quota. */
export function ruleHasBurningTier(rule: UsageRule): boolean {
  return rule.tiers.some((t) => t.expireUnused);
}

// ---------------------------------------------------------------------------
// Period math
// ---------------------------------------------------------------------------

/**
 * Periods are anchored at the package start date (purchase or renewal), not at calendar weeks or months.
 *
 * Time zone: CALENDAR months are computed on the studio's wall clock (IANA zone, UTC when none is
 * given), so "the same day next month" is the day the member saw at purchase and the time of day is
 * kept. Fixed-length tiers (WEEK, DAYS, FIXED_DAYS months) are plain multiples of 24 hours.
 *
 * Freezes: a frozen package does not use up period time. Internally the instant is mapped to a
 * "virtual" instant (wall time minus the frozen time since the start), the boundaries are computed on
 * that virtual timeline and mapped back, so every boundary after a freeze moves by the freeze length.
 * A boundary that lands exactly on a freeze start stays before the freeze.
 */
export interface FreezeInterval {
  start: Date | string;
  end: Date | string;
}

/** One period of a tier: `end` is exclusive, an instant exactly on a boundary belongs to the new period. */
export interface UsagePeriod {
  index: number;
  start: Date;
  end: Date;
}

interface Span {
  start: number;
  end: number;
}

/** Freeze intervals clipped to the package start, sorted and merged. */
function normalizeFreezes(startMs: number, freezes: readonly FreezeInterval[]): Span[] {
  const spans = freezes
    .map((f) => ({ start: Math.max(startMs, new Date(f.start).getTime()), end: new Date(f.end).getTime() }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** Wall time to virtual time: removes the frozen time that elapsed before `atMs`. */
function toVirtual(spans: readonly Span[], atMs: number): number {
  let frozen = 0;
  for (const s of spans) {
    if (s.start >= atMs) break;
    frozen += Math.min(s.end, atMs) - s.start;
  }
  return atMs - frozen;
}

/** Virtual time to wall time: every freeze that started before the instant pushes it later by its length. */
function toWall(spans: readonly Span[], virtualMs: number): number {
  let wall = virtualMs;
  for (const s of spans) {
    if (s.start < wall) wall += s.end - s.start;
    else break;
  }
  return wall;
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** The instant of a wall-clock reading in the zone (a time skipped by a DST gap lands just after it). */
function wallToInstant(year: number, month0: number, day: number, hour: number, minute: number, second: number, ms: number, zone: string): number {
  const guess = Date.UTC(year, month0, day, hour, minute, second, ms);
  const first = zoneOffsetMs(new Date(guess), zone);
  let instant = guess - first;
  const second2 = zoneOffsetMs(new Date(instant), zone);
  if (second2 !== first) instant = guess - second2;
  return instant;
}

/**
 * `date` plus whole calendar months on the zone's wall clock. The day of month of `anchor` is kept and
 * clamped to the target month's length (Jan 31 -> Feb 28/29 -> Mar 31 when always counted from the anchor).
 */
export function addMonthsClamped(anchor: Date, months: number, timeZone = 'UTC'): Date {
  const zone = safeZone(timeZone);
  const p = partsInZone(anchor, zone);
  const total = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(total / 12);
  const month0 = total - year * 12;
  const day = Math.min(p.day, daysInMonth(year, month0));
  return new Date(wallToInstant(year, month0, day, p.hour, p.minute, p.second, anchor.getUTCMilliseconds(), zone));
}

/** Boundary `k` (k >= 0) of a tier on the virtual timeline; boundary 0 is the package start. */
function virtualBoundary(startMs: number, tier: UsageTier, k: number, zone: string): number {
  switch (tier.unit) {
    case 'DAYS':
      return startMs + k * tier.length * DAY_MS;
    case 'WEEK':
      return startMs + k * tier.length * 7 * DAY_MS;
    case 'MONTH':
      if (tier.monthMode === 'FIXED_DAYS') return startMs + k * tier.length * (tier.fixedMonthDays ?? 30) * DAY_MS;
      return addMonthsClamped(new Date(startMs), k * tier.length, zone).getTime();
  }
}

/** Index of the period that contains the virtual instant (virtualMs >= startMs). */
function virtualIndex(startMs: number, tier: UsageTier, virtualMs: number, zone: string): number {
  let k: number;
  if (tier.unit === 'MONTH' && tier.monthMode !== 'FIXED_DAYS') {
    // Estimate from the average month length, then settle on the exact boundary.
    k = Math.max(0, Math.floor((virtualMs - startMs) / (tier.length * 30.4375 * DAY_MS)));
  } else {
    const len = virtualBoundary(startMs, tier, 1, zone) - startMs;
    k = Math.max(0, Math.floor((virtualMs - startMs) / len));
  }
  while (k > 0 && virtualBoundary(startMs, tier, k, zone) > virtualMs) k -= 1;
  while (virtualBoundary(startMs, tier, k + 1, zone) <= virtualMs) k += 1;
  return k;
}

function periodOf(startMs: number, tier: UsageTier, spans: readonly Span[], index: number, zone: string): UsagePeriod {
  return {
    index,
    start: new Date(toWall(spans, virtualBoundary(startMs, tier, index, zone))),
    end: new Date(toWall(spans, virtualBoundary(startMs, tier, index + 1, zone))),
  };
}

/** The period of `tier` that contains `at`; null before the package start. */
export function periodAt(startDate: Date | string, tier: UsageTier, freezes: readonly FreezeInterval[], at: Date, timeZone = 'UTC'): UsagePeriod | null {
  const startMs = new Date(startDate).getTime();
  if (at.getTime() < startMs) return null;
  const zone = safeZone(timeZone);
  const spans = normalizeFreezes(startMs, freezes);
  const index = virtualIndex(startMs, tier, toVirtual(spans, at.getTime()), zone);
  return periodOf(startMs, tier, spans, index, zone);
}

/**
 * Periods of `tier` that ended by `now` (end <= now), oldest first. `notAfter` (the package end date)
 * drops the final, clipped period: at the end date the normal expiry applies and nothing needs burning.
 */
export function periodsEnded(
  startDate: Date | string,
  tier: UsageTier,
  freezes: readonly FreezeInterval[],
  now: Date,
  options: { timeZone?: string; notAfter?: Date | string | null; limit?: number } = {},
): UsagePeriod[] {
  const startMs = new Date(startDate).getTime();
  const zone = safeZone(options.timeZone ?? 'UTC');
  const spans = normalizeFreezes(startMs, freezes);
  const notAfterMs = options.notAfter ? new Date(options.notAfter).getTime() : Number.POSITIVE_INFINITY;
  const limit = options.limit ?? 500;
  const out: UsagePeriod[] = [];
  for (let k = 0; out.length < limit; k += 1) {
    const period = periodOf(startMs, tier, spans, k, zone);
    if (period.end.getTime() > now.getTime() || period.end.getTime() > notAfterMs) break;
    out.push(period);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Consumption
// ---------------------------------------------------------------------------

export interface ConsumptionBooking {
  status: string;
  unitsCharged: number;
  penaltyUnits: number;
}

/**
 * What a booking has used up of its package, matching what actually left `remainingUnits`: a live,
 * attended booking keeps everything it charged; a cancellation or no-show keeps only the penalty (the
 * rest was refunded, see cancellation-policy.ts). An unlimited package has no units, so a visit counts 1
 * while the booking is live, attended or a no-show and 0 once cancelled. A waitlist entry has not paid.
 */
export function netUnitsConsumed(booking: ConsumptionBooking, entitlementKind: string): number {
  const live = booking.status === 'CONFIRMED' || booking.status === 'ATTENDED';
  if (entitlementKind === 'TIME_UNLIMITED') return live || booking.status === 'NO_SHOW' ? 1 : 0;
  if (live) return booking.unitsCharged;
  if (booking.status === 'NO_SHOW' || booking.status === 'CANCELLED_EARLY' || booking.status === 'CANCELLED_LATE') return booking.penaltyUnits;
  return 0;
}

/** Net credits an event registration keeps: what was charged minus what was refunded. */
export function netEventUnitsConsumed(registration: { unitsCharged: number; refundedUnits: number }): number {
  return Math.max(0, registration.unitsCharged - registration.refundedUnits);
}

/**
 * Units a period burns at its end: the quota that was neither used nor already burned by a finer tier
 * inside this period, never more than what the package still holds.
 */
export function burnUnits(input: { quota: number; consumed: number; finerBurned: number; remainingUnits: number }): number {
  const unused = input.quota - input.consumed - input.finerBurned;
  return Math.max(0, Math.min(unused, Math.max(0, input.remainingUnits)));
}

/** True when `periodEnd` (the end of a finer period) falls inside the coarser period (start, end]. */
export function endsInside(periodEnd: Date, coarser: { start: Date; end: Date }): boolean {
  return periodEnd.getTime() > coarser.start.getTime() && periodEnd.getTime() <= coarser.end.getTime();
}

/** First tier whose quota would be exceeded by `cost` more units, with the period that blocks it. */
export function firstBlockingTier(
  checks: readonly { tier: UsageTier; period: UsagePeriod; consumed: number }[],
  cost: number,
): { tier: UsageTier; period: UsagePeriod; consumed: number } | null {
  for (const check of checks) {
    if (check.consumed + cost > check.tier.quota) return check;
  }
  return null;
}

/** Current period of one tier as the member and staff screens show it. */
export interface UsagePeriodStatusDTO {
  unit: UsageTierUnit;
  length: number;
  /** ISO instants; periodEnd is clipped to the package end date. */
  periodStart: string;
  periodEnd: string;
  quota: number;
  used: number;
  remaining: number;
  expireUnused: boolean;
  /** IANA time zone of the studio: screens format the period dates in it, whatever the device zone is. */
  timeZone: string;
}

/** Owner-only studio switch (PUT studios/:studioId/usage-periods). */
export const UpdateUsagePeriodsSettingSchema = z.object({ enabled: z.boolean() });
export type UpdateUsagePeriodsSettingInput = z.infer<typeof UpdateUsagePeriodsSettingSchema>;

export interface UsagePeriodsSettingDTO {
  enabled: boolean;
}

/** Sets or clears (null) the usage rule of a package definition (PATCH catalog/package-definitions/:id/usage-rule). */
export const SetPackageUsageRuleSchema = z.object({ usageRule: UsageRuleSchema.nullable() });
export type SetPackageUsageRuleInput = z.infer<typeof SetPackageUsageRuleSchema>;

/** One burn row of a member package, for the history listing. */
export interface PackageUnitExpiryDTO {
  id: string;
  memberPackageId: string;
  tierUnit: UsageTierUnit;
  periodStart: string;
  periodEnd: string;
  units: number;
  createdAt: string;
}
