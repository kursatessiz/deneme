import { addZonedDays, changeRatio, dashboardPeriodRange, enumerateZonedDays, memberGrowthRate, zonedDateKey, zonedMidnight, zonedStartOfWeek } from './periods';

describe('addZonedDays', () => {
  it('keeps the local wall time across the autumn DST change in Berlin', () => {
    // 2026-10-24 18:00 CEST (UTC+2); clocks go back on 2026-10-25.
    const start = new Date('2026-10-24T16:00:00.000Z');
    expect(addZonedDays(start, 7, 'Europe/Berlin').toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(addZonedDays(start, 0, 'Europe/Berlin').toISOString()).toBe(start.toISOString());
  });

  it('keeps the local wall time across the spring DST change and in zones without DST', () => {
    const start = new Date('2026-03-22T17:00:00.000Z'); // 18:00 CET
    expect(addZonedDays(start, 7, 'Europe/Berlin').toISOString()).toBe('2026-03-29T16:00:00.000Z');
    expect(addZonedDays(start, 7, 'Europe/Istanbul').getTime() - start.getTime()).toBe(7 * 24 * 3600_000);
  });
});

describe('zoned helpers', () => {
  it('finds local midnight in zones east and west of UTC', () => {
    expect(zonedMidnight(2026, 10, 5, 'Europe/Istanbul').toISOString()).toBe('2026-10-04T21:00:00.000Z');
    expect(zonedMidnight(2026, 10, 5, 'America/New_York').toISOString()).toBe('2026-10-05T04:00:00.000Z');
    expect(zonedMidnight(2026, 1, 1, 'UTC').toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('handles daylight saving changes', () => {
    // Europe/Berlin moves to summer time on 2026-03-29.
    expect(zonedMidnight(2026, 3, 29, 'Europe/Berlin').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(zonedMidnight(2026, 3, 30, 'Europe/Berlin').toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(zonedMidnight(2026, 5, 1, 'Mars/Olympus').toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('keys days in the zone', () => {
    expect(zonedDateKey(new Date('2026-10-04T22:30:00Z'), 'Europe/Istanbul')).toBe('2026-10-05');
    expect(zonedDateKey(new Date('2026-10-04T22:30:00Z'), 'UTC')).toBe('2026-10-04');
  });

  it('starts weeks on Monday', () => {
    // 2026-10-07 is a Wednesday.
    expect(zonedStartOfWeek(new Date('2026-10-07T12:00:00Z'), 'UTC').toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(zonedStartOfWeek(new Date('2026-10-05T00:30:00Z'), 'UTC').toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(zonedStartOfWeek(new Date('2026-10-04T23:00:00Z'), 'UTC').toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });

  it('enumerates local days', () => {
    expect(enumerateZonedDays(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-03T12:00:00Z'), 'UTC')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });
});

describe('dashboardPeriodRange', () => {
  const now = new Date('2026-10-07T12:00:00Z');

  it('today compares with yesterday up to the same time', () => {
    const r = dashboardPeriodRange('today', now, 'UTC');
    expect(r.from.toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(r.to.toISOString()).toBe(now.toISOString());
    expect(r.previousFrom.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(r.previousTo.toISOString()).toBe('2026-10-06T12:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it('week compares with last week up to the same time', () => {
    const r = dashboardPeriodRange('week', now, 'UTC');
    expect(r.from.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(r.previousFrom.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(r.previousTo.toISOString()).toBe('2026-09-30T12:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('month compares with the same days of last month, capped at its end', () => {
    const r = dashboardPeriodRange('month', now, 'UTC');
    expect(r.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(r.previousFrom.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(r.previousTo.toISOString()).toBe('2026-09-07T12:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    const endOfMonth = dashboardPeriodRange('month', new Date('2026-03-31T12:00:00Z'), 'UTC');
    expect(endOfMonth.previousTo.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('last30 compares with the 30 days before', () => {
    const r = dashboardPeriodRange('last30', now, 'UTC');
    expect(r.to.getTime() - r.from.getTime()).toBe(30 * 86400000);
    expect(r.previousTo.getTime()).toBe(r.from.getTime());
  });

  it('resolves in the studio zone', () => {
    const r = dashboardPeriodRange('today', new Date('2026-10-04T22:30:00Z'), 'Europe/Istanbul');
    expect(r.from.toISOString()).toBe('2026-10-04T21:00:00.000Z');
  });
});

describe('ratios', () => {
  it('computes change and guards against a zero base', () => {
    expect(changeRatio(120, 100)).toBeCloseTo(0.2);
    expect(changeRatio(80, 100)).toBeCloseTo(-0.2);
    expect(changeRatio(5, 0)).toBeNull();
  });

  it('computes net member growth on the reconstructed starting base', () => {
    expect(memberGrowthRate({ activeNow: 110, joined: 15, churned: 5 })).toBeCloseTo(0.1);
    expect(memberGrowthRate({ activeNow: 5, joined: 5, churned: 0 })).toBeNull();
    expect(memberGrowthRate({ activeNow: 90, joined: 0, churned: 10 })).toBeCloseTo(-0.1);
  });
});
