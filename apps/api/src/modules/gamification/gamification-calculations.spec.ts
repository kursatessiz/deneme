import {
  computeStreakWeeks,
  countDistinctServiceTypes,
  countSessionsInLocalMonth,
  getLocalDateKey,
  getLocalMonthKey,
  isEarlyBirdSession,
  reachedMilestones,
  weekStartOf,
} from './gamification-calculations';

const TZ_ISTANBUL = 'Europe/Istanbul'; // UTC+3, no DST since 2016
const TZ_LA = 'America/Los_Angeles'; // observes DST, useful for a boundary check

describe('gamification-calculations', () => {
  describe('getLocalDateKey / getLocalMonthKey', () => {
    it('reads the calendar date in the studio timezone, not UTC', () => {
      // 23:30 UTC on Dec 31 is already Jan 1st, 02:30 in Istanbul.
      const instant = new Date('2025-12-31T23:30:00.000Z');
      expect(getLocalDateKey(instant, TZ_ISTANBUL)).toBe('2026-01-01');
      expect(getLocalMonthKey(instant, TZ_ISTANBUL)).toBe('2026-01');
      // Same instant is still Dec 31 on the US west coast.
      expect(getLocalDateKey(instant, TZ_LA)).toBe('2025-12-31');
    });
  });

  describe('weekStartOf', () => {
    it('is the same Monday for every day within an ISO week', () => {
      const monday = new Date('2026-01-05T10:00:00.000Z'); // Monday in Istanbul
      const sunday = new Date('2026-01-11T20:00:00.000Z'); // Sunday in Istanbul
      expect(weekStartOf(sunday, TZ_ISTANBUL)).toBe(weekStartOf(monday, TZ_ISTANBUL));
    });

    it('rolls over correctly across a year boundary (ISO week 1 vs week 53)', () => {
      // Dec 29 2025 (Mon) .. Jan 4 2026 (Sun) is one ISO week (2026-W01);
      // the following Monday starts a new week.
      const lastDayOfThatWeek = new Date('2026-01-04T12:00:00.000Z');
      const nextMonday = new Date('2026-01-05T12:00:00.000Z');
      expect(weekStartOf(nextMonday, TZ_ISTANBUL) - weekStartOf(lastDayOfThatWeek, TZ_ISTANBUL)).toBe(7 * 86400000);
    });
  });

  describe('computeStreakWeeks', () => {
    const at = (iso: string) => new Date(iso);

    it('counts a single qualifying week as a streak of 1', () => {
      const result = computeStreakWeeks(
        [at('2026-01-05T09:00:00.000Z')],
        TZ_ISTANBUL,
        1,
        at('2026-01-07T09:00:00.000Z'),
      );
      expect(result.currentStreakWeeks).toBe(1);
      expect(result.bestStreakWeeks).toBe(1);
    });

    it('builds a streak across consecutive weeks and keeps best after it breaks', () => {
      const sessions = [
        at('2026-01-05T09:00:00.000Z'), // week of Jan 5
        at('2026-01-12T09:00:00.000Z'), // week of Jan 12
        at('2026-01-19T09:00:00.000Z'), // week of Jan 19
        // gap: no session week of Jan 26
        at('2026-02-02T09:00:00.000Z'), // week of Feb 2 (new streak of 1)
      ];
      const reference = at('2026-02-03T09:00:00.000Z');
      const result = computeStreakWeeks(sessions, TZ_ISTANBUL, 1, reference);
      expect(result.bestStreakWeeks).toBe(3);
      expect(result.currentStreakWeeks).toBe(1);
    });

    it('does not break the streak while the current week is still in progress', () => {
      const sessions = [at('2026-01-05T09:00:00.000Z'), at('2026-01-12T09:00:00.000Z')];
      // Reference date is in the following week (Jan 19), which has no
      // session yet -- the streak should still read as 2, not reset to 0.
      const reference = at('2026-01-20T09:00:00.000Z');
      const result = computeStreakWeeks(sessions, TZ_ISTANBUL, 1, reference);
      expect(result.currentStreakWeeks).toBe(2);
    });

    it('resets current streak to 0 after a full missed week', () => {
      const sessions = [at('2026-01-05T09:00:00.000Z')];
      // Two weeks after the last session and its following week: broken.
      const reference = at('2026-01-27T09:00:00.000Z');
      const result = computeStreakWeeks(sessions, TZ_ISTANBUL, 1, reference);
      expect(result.currentStreakWeeks).toBe(0);
      expect(result.bestStreakWeeks).toBe(1);
    });

    it('honours minSessionsPerWeek: a week under quota does not qualify', () => {
      const sessions = [
        at('2026-01-05T09:00:00.000Z'),
        at('2026-01-06T09:00:00.000Z'),
        at('2026-01-12T09:00:00.000Z'), // only 1 this week, quota is 2
      ];
      const result = computeStreakWeeks(sessions, TZ_ISTANBUL, 2, at('2026-01-14T09:00:00.000Z'));
      expect(result.bestStreakWeeks).toBe(1);
      // The current (still open) week has not met quota yet, but the
      // immediately preceding week did, so the streak is not broken yet.
      expect(result.currentStreakWeeks).toBe(1);
    });

    it('breaks the streak once a fully-elapsed week misses quota', () => {
      const sessions = [at('2026-01-05T09:00:00.000Z'), at('2026-01-06T09:00:00.000Z')];
      // Two weeks later: the in-between week (Jan 12) is now fully elapsed
      // and never met quota, so the streak must be broken, not just "in progress".
      const result = computeStreakWeeks(sessions, TZ_ISTANBUL, 2, at('2026-01-21T09:00:00.000Z'));
      expect(result.currentStreakWeeks).toBe(0);
    });

    it('is computed in the studio timezone, not UTC', () => {
      // 23:30 UTC Sunday Jan 4 is already Monday Jan 5 local in Istanbul,
      // i.e. the start of the *next* ISO week rather than the same one.
      const lateSunday = at('2026-01-04T23:30:00.000Z');
      const nextMondaySession = at('2026-01-05T20:00:00.000Z');
      const result = computeStreakWeeks([lateSunday, nextMondaySession], TZ_ISTANBUL, 1, nextMondaySession);
      // Both sessions land in the same local week (2026-W02) in Istanbul.
      expect(result.currentStreakWeeks).toBe(1);
    });
  });

  describe('reachedMilestones', () => {
    it('returns only thresholds at or below the total, ascending', () => {
      expect(reachedMilestones(27, [1, 10, 25, 50, 100])).toEqual([1, 10, 25]);
      expect(reachedMilestones(0, [1, 10])).toEqual([]);
      expect(reachedMilestones(100, [1, 10, 25, 50, 100, 250])).toEqual([1, 10, 25, 50, 100]);
    });
  });

  describe('countDistinctServiceTypes', () => {
    it('deduplicates service type ids', () => {
      expect(countDistinctServiceTypes(['a', 'b', 'a', 'c', 'b'])).toBe(3);
      expect(countDistinctServiceTypes([])).toBe(0);
    });
  });

  describe('isEarlyBirdSession', () => {
    it('is true strictly before the configured local hour', () => {
      // 04:59 UTC = 07:59 Istanbul -> before 08:00.
      expect(isEarlyBirdSession(new Date('2026-01-05T04:59:00.000Z'), TZ_ISTANBUL, 8)).toBe(true);
      // 05:00 UTC = 08:00 Istanbul -> not before 08:00.
      expect(isEarlyBirdSession(new Date('2026-01-05T05:00:00.000Z'), TZ_ISTANBUL, 8)).toBe(false);
      expect(isEarlyBirdSession(new Date('2026-01-05T09:00:00.000Z'), TZ_ISTANBUL, 8)).toBe(false);
    });
  });

  describe('countSessionsInLocalMonth', () => {
    it('only counts sessions whose local date falls in that month', () => {
      const sessions = [
        new Date('2026-01-31T22:00:00.000Z'), // Feb 1 local in Istanbul
        new Date('2026-02-15T09:00:00.000Z'),
        new Date('2026-02-28T20:00:00.000Z'),
        new Date('2026-03-01T05:00:00.000Z'), // Mar 1 local
      ];
      expect(countSessionsInLocalMonth(sessions, TZ_ISTANBUL, '2026-02')).toBe(3);
      expect(countSessionsInLocalMonth(sessions, TZ_ISTANBUL, '2026-01')).toBe(0);
    });
  });
});
