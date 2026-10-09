import { computeExpectedPayout, computeReservedSpots, isAllocationClosed, partnerVisitMonthKey } from './partner-quota';

describe('computeReservedSpots', () => {
  it('reserves the configured spots when capacity allows', () => {
    expect(computeReservedSpots(3, 10)).toBe(3);
  });

  it('caps the reservation at the free capacity', () => {
    expect(computeReservedSpots(5, 2)).toBe(2);
  });

  it('never goes negative when capacity is already exhausted', () => {
    expect(computeReservedSpots(5, -1)).toBe(0);
    expect(computeReservedSpots(5, 0)).toBe(0);
  });
});

describe('isAllocationClosed', () => {
  const releaseAt = new Date('2026-01-01T10:00:00Z');

  it('is open before release and not released', () => {
    expect(isAllocationClosed(false, releaseAt, new Date('2026-01-01T09:59:00Z'))).toBe(false);
  });

  it('is closed once the release time has passed', () => {
    expect(isAllocationClosed(false, releaseAt, new Date('2026-01-01T10:00:00Z'))).toBe(true);
    expect(isAllocationClosed(false, releaseAt, new Date('2026-01-01T10:01:00Z'))).toBe(true);
  });

  it('is closed once flagged released regardless of time', () => {
    expect(isAllocationClosed(true, releaseAt, new Date('2020-01-01T00:00:00Z'))).toBe(true);
  });
});

describe('computeExpectedPayout', () => {
  it('multiplies a decimal rate by the visit count with no floating point drift', () => {
    expect(computeExpectedPayout('49.90', 3)).toBe('149.70');
  });

  it('handles zero visits', () => {
    expect(computeExpectedPayout('49.90', 0)).toBe('0.00');
  });

  it('avoids the classic 0.1 + 0.2 style floating point error over many visits', () => {
    expect(computeExpectedPayout('10.10', 37)).toBe('373.70');
  });
});

describe('partnerVisitMonthKey', () => {
  it('buckets by the session month: a 28 Jan booking for a 3 Feb session is February', () => {
    // The booking creation date is irrelevant; only the session start is passed.
    expect(partnerVisitMonthKey(new Date('2026-02-03T10:00:00Z'), 'Europe/Istanbul')).toBe('2026-02');
  });

  it('a session at 23:30 local on the last day of a month stays in that month (ahead of UTC)', () => {
    // 23:30 Istanbul (UTC+3) on 31 Jan is 20:30Z the same day.
    expect(partnerVisitMonthKey(new Date('2026-01-31T20:30:00Z'), 'Europe/Istanbul')).toBe('2026-01');
  });

  it('a session at 23:30 local on the last day of a month stays in that month (behind UTC)', () => {
    // 23:30 Los Angeles (UTC-8) on 31 Jan is 07:30Z on 1 Feb: UTC would say February.
    expect(partnerVisitMonthKey(new Date('2026-02-01T07:30:00Z'), 'America/Los_Angeles')).toBe('2026-01');
  });

  it('a session at 00:30 local on the first day belongs to the new month although UTC is still the old one', () => {
    expect(partnerVisitMonthKey(new Date('2026-01-31T21:30:00Z'), 'Europe/Istanbul')).toBe('2026-02');
  });
});
