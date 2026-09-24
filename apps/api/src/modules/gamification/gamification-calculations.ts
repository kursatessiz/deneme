/**
 * Pure functions for W16 gamification: streaks, milestones, monthly
 * progress, variety and the early-bird check. Everything here takes plain
 * data (Date objects, an IANA timezone string, numbers) and returns plain
 * data, so it can be unit tested without a database and reused by both the
 * evaluator service and the backfill job.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface LocalDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/**
 * Reads a UTC instant as calendar parts in `timeZone`. Uses Intl so it is
 * correct across DST transitions without any date library.
 */
export function getLocalDateParts(instant: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** "YYYY-MM-DD" for the given instant in `timeZone`. */
export function getLocalDateKey(instant: Date, timeZone: string): string {
  const { year, month, day } = getLocalDateParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "YYYY-MM" for the given instant in `timeZone`. */
export function getLocalMonthKey(instant: Date, timeZone: string): string {
  const { year, month } = getLocalDateParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The UTC timestamp (midnight) of the Monday that starts the ISO week
 * containing the given local calendar date. Used as a stable, sortable
 * week identity: consecutive weeks differ by exactly 7 days in ms, which
 * makes streak adjacency a plain subtraction, independent of ISO week
 * numbering (week 53 / year-end edge cases included).
 */
export function weekStartFromLocalDate(parts: Pick<LocalDateParts, 'year' | 'month' | 'day'>): number {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const isoWeekday = (date.getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  date.setUTCDate(date.getUTCDate() - isoWeekday);
  return date.getTime();
}

/** Same as `weekStartFromLocalDate`, but reads the local date from an instant. */
export function weekStartOf(instant: Date, timeZone: string): number {
  return weekStartFromLocalDate(getLocalDateParts(instant, timeZone));
}

export interface StreakResult {
  currentStreakWeeks: number;
  bestStreakWeeks: number;
}

/**
 * Consecutive ISO weeks (studio timezone) with at least `minSessionsPerWeek`
 * attended sessions.
 *
 * `bestStreakWeeks` is the longest such run anywhere in the history.
 * `currentStreakWeeks` counts backward from the most recent qualifying week
 * as long as it is the week of `referenceDate` or the week right before it
 * (a streak in progress is not broken by an unfinished current week); any
 * larger gap resets it to 0.
 */
export function computeStreakWeeks(
  attendedAt: readonly Date[],
  timeZone: string,
  minSessionsPerWeek: number,
  referenceDate: Date = new Date(),
): StreakResult {
  const countsByWeek = new Map<number, number>();
  for (const at of attendedAt) {
    const weekStart = weekStartOf(at, timeZone);
    countsByWeek.set(weekStart, (countsByWeek.get(weekStart) ?? 0) + 1);
  }

  const qualifyingWeeks = [...countsByWeek.entries()]
    .filter(([, count]) => count >= minSessionsPerWeek)
    .map(([weekStart]) => weekStart)
    .sort((a, b) => a - b);

  let bestStreakWeeks = 0;
  let run = 0;
  let previous: number | null = null;
  for (const week of qualifyingWeeks) {
    run = previous !== null && week - previous === WEEK_MS ? run + 1 : 1;
    bestStreakWeeks = Math.max(bestStreakWeeks, run);
    previous = week;
  }

  const qualifyingSet = new Set(qualifyingWeeks);
  const referenceWeek = weekStartOf(referenceDate, timeZone);
  let anchor: number | null = null;
  if (qualifyingSet.has(referenceWeek)) {
    anchor = referenceWeek;
  } else if (qualifyingSet.has(referenceWeek - WEEK_MS)) {
    // The current week is still in progress; do not break the streak yet.
    anchor = referenceWeek - WEEK_MS;
  }

  let currentStreakWeeks = 0;
  if (anchor !== null) {
    let cursor = anchor;
    while (qualifyingSet.has(cursor)) {
      currentStreakWeeks += 1;
      cursor -= WEEK_MS;
    }
  }

  return { currentStreakWeeks, bestStreakWeeks };
}

/** Milestone thresholds reached (<=) by the given attended session count, ascending. */
export function reachedMilestones(totalAttendedSessions: number, thresholds: readonly number[]): number[] {
  return [...thresholds].filter((t) => totalAttendedSessions >= t).sort((a, b) => a - b);
}

/** Number of distinct service types among attended sessions. */
export function countDistinctServiceTypes(serviceTypeIds: readonly string[]): number {
  return new Set(serviceTypeIds).size;
}

/** True when a session's local start time is strictly before `beforeHour:00`. */
export function isEarlyBirdSession(startTime: Date, timeZone: string, beforeHour: number): boolean {
  const { hour, minute } = getLocalDateParts(startTime, timeZone);
  return hour * 60 + minute < beforeHour * 60;
}

/** Attended sessions whose local date falls within the "YYYY-MM" month. */
export function countSessionsInLocalMonth(attendedAt: readonly Date[], timeZone: string, month: string): number {
  return attendedAt.filter((at) => getLocalMonthKey(at, timeZone) === month).length;
}

export { DAY_MS, WEEK_MS };
