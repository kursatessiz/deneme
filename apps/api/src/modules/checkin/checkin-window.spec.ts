import { computeCheckInWindow, sortByClosestStart } from './checkin-window';

describe('computeCheckInWindow', () => {
  it('computes the default 30 min before / 15 min after window', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');
    const { windowStart, windowEnd } = computeCheckInWindow(now, 30, 15);
    expect(windowStart.toISOString()).toBe('2026-09-24T09:30:00.000Z');
    expect(windowEnd.toISOString()).toBe('2026-09-24T10:15:00.000Z');
  });

  it('supports a zero-width window', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');
    const { windowStart, windowEnd } = computeCheckInWindow(now, 0, 0);
    expect(windowStart.getTime()).toBe(now.getTime());
    expect(windowEnd.getTime()).toBe(now.getTime());
  });
});

describe('sortByClosestStart', () => {
  it('orders items by absolute distance from now, nearest first', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');
    const items = [
      { label: 'far-future', start: new Date('2026-09-24T10:14:00.000Z') },
      { label: 'near-past', start: new Date('2026-09-24T09:55:00.000Z') },
      { label: 'exact', start: new Date('2026-09-24T10:00:00.000Z') },
    ];
    const sorted = sortByClosestStart(items, (i) => i.start, now);
    expect(sorted.map((i) => i.label)).toEqual(['exact', 'near-past', 'far-future']);
  });

  it('does not mutate the input array', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');
    const items = [{ start: new Date('2026-09-24T09:00:00.000Z') }, { start: new Date('2026-09-24T10:00:00.000Z') }];
    const original = [...items];
    sortByClosestStart(items, (i) => i.start, now);
    expect(items).toEqual(original);
  });
});
