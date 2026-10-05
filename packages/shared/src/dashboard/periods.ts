import type { DashboardPeriod } from './widgets';

/**
 * Period arithmetic of the overview cards, in the studio's IANA time zone
 * (no zone is assumed). Pure, so the API and the tests share it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsInZone(date: Date, timeZone: string): ZonedParts {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return { year: values.year, month: values.month, day: values.day, hour: values.hour % 24, minute: values.minute, second: values.second };
}

/** Offset of the zone from UTC at `date`, in ms (positive east of Greenwich). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - date.getUTCMilliseconds());
}

/** The instant of local midnight of the given calendar day in the zone (month is 1 based; overflow rolls over). */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const zone = safeZone(timeZone);
  const guess = Date.UTC(year, month - 1, day);
  const first = zoneOffsetMs(new Date(guess), zone);
  let instant = guess - first;
  const second = zoneOffsetMs(new Date(instant), zone);
  if (second !== first) instant = guess - second;
  return new Date(instant);
}

/** Calendar day of `date` in the zone, as `YYYY-MM-DD`. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = partsInZone(date, safeZone(timeZone));
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Local midnight of the day `date` falls on, in the zone. */
export function zonedStartOfDay(date: Date, timeZone: string): Date {
  const p = partsInZone(date, safeZone(timeZone));
  return zonedMidnight(p.year, p.month, p.day, timeZone);
}

/** Monday 00:00 of the ISO week `date` falls in, in the zone. */
export function zonedStartOfWeek(date: Date, timeZone: string): Date {
  const p = partsInZone(date, safeZone(timeZone));
  const weekday = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7; // Monday = 0
  return zonedMidnight(p.year, p.month, p.day - weekday, timeZone);
}

export interface DashboardPeriodRange {
  /** Start of the current period (inclusive). */
  from: Date;
  /** End of the current period (exclusive): now. */
  to: Date;
  /** The comparison window: the previous period up to the same point. */
  previousFrom: Date;
  previousTo: Date;
}

/**
 * The window a period card summarises and the one it compares with.
 * today: since local midnight, compared with yesterday up to the same time;
 * week: since Monday, compared with last week up to the same time; month:
 * since the 1st, compared with last month up to the same day and time
 * (capped at that month's end); last30: the last 30 days, compared with the
 * 30 days before.
 */
export function dashboardPeriodRange(period: DashboardPeriod, now: Date, timeZone: string): DashboardPeriodRange {
  const zone = safeZone(timeZone);
  const to = new Date(now.getTime());
  const p = partsInZone(now, zone);
  switch (period) {
    case 'today': {
      const from = zonedMidnight(p.year, p.month, p.day, zone);
      const previousFrom = zonedMidnight(p.year, p.month, p.day - 1, zone);
      return { from, to, previousFrom, previousTo: new Date(previousFrom.getTime() + (to.getTime() - from.getTime())) };
    }
    case 'week': {
      const from = zonedStartOfWeek(now, zone);
      const fp = partsInZone(from, zone);
      const previousFrom = zonedMidnight(fp.year, fp.month, fp.day - 7, zone);
      return { from, to, previousFrom, previousTo: new Date(previousFrom.getTime() + (to.getTime() - from.getTime())) };
    }
    case 'month': {
      const from = zonedMidnight(p.year, p.month, 1, zone);
      const previousFrom = zonedMidnight(p.year, p.month - 1, 1, zone);
      const previousTo = new Date(Math.min(previousFrom.getTime() + (to.getTime() - from.getTime()), from.getTime()));
      return { from, to, previousFrom, previousTo };
    }
    case 'last30':
    default: {
      const from = new Date(to.getTime() - 30 * DAY_MS);
      return { from, to, previousFrom: new Date(from.getTime() - 30 * DAY_MS), previousTo: from };
    }
  }
}

/** Every local calendar day (`YYYY-MM-DD`) touched by [from, to), in order. */
export function enumerateZonedDays(from: Date, to: Date, timeZone: string): string[] {
  const zone = safeZone(timeZone);
  const days: string[] = [];
  if (to.getTime() <= from.getTime()) return [zonedDateKey(from, zone)];
  const start = partsInZone(from, zone);
  for (let i = 0; i < 400; i += 1) {
    const midnight = zonedMidnight(start.year, start.month, start.day + i, zone);
    if (midnight.getTime() >= to.getTime()) break;
    days.push(zonedDateKey(midnight, zone));
  }
  return days;
}

/** (current - previous) / previous; null when there is nothing to compare with. */
export function changeRatio(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

/**
 * Net member growth of a period: (joined - churned) / members at the start
 * of the period, where the start count is reconstructed as today's active
 * count minus the net change. Null when the base is not positive.
 */
export function memberGrowthRate(input: { activeNow: number; joined: number; churned: number }): number | null {
  const net = input.joined - input.churned;
  const base = input.activeNow - net;
  if (base <= 0) return null;
  return net / base;
}
