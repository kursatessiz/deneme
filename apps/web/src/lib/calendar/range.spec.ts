import { rangeForView, stepAnchor, snapToSlot, moveByMinutes, startOfWeek, isSameDay, weekdayLabel } from './range';

describe('rangeForView', () => {
  it('day view covers exactly one local day', () => {
    const { start, end } = rangeForView('day', new Date(2026, 2, 17, 14, 30));
    expect(start).toEqual(new Date(2026, 2, 17, 0, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 2, 18, 0, 0, 0, 0));
  });

  it('week view starts on Monday and spans 7 days', () => {
    // 2026-03-17 is a Tuesday.
    const { start, end } = rangeForView('week', new Date(2026, 2, 17));
    expect(start).toEqual(new Date(2026, 2, 16, 0, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 2, 23, 0, 0, 0, 0));
  });

  it('month view widens to full weeks (no partial row)', () => {
    const { start, end } = rangeForView('month', new Date(2026, 2, 17));
    // March 2026 starts on a Sunday -> grid starts the Monday before (Feb 23).
    expect(start).toEqual(new Date(2026, 1, 23, 0, 0, 0, 0));
    // Grid end is always a Monday, strictly after the month's last day.
    expect(end.getDay()).toBe(1);
    expect(end.getTime()).toBeGreaterThan(new Date(2026, 2, 31).getTime());
  });
});

describe('stepAnchor', () => {
  it('moves a day view by one day', () => {
    const next = stepAnchor('day', new Date(2026, 2, 17), 1);
    expect(isSameDay(next, new Date(2026, 2, 18))).toBe(true);
  });

  it('moves a week view by seven days', () => {
    const prev = stepAnchor('week', new Date(2026, 2, 17), -1);
    expect(isSameDay(prev, new Date(2026, 2, 10))).toBe(true);
  });

  it('moves a month view by one calendar month', () => {
    const next = stepAnchor('month', new Date(2026, 2, 17), 1);
    expect(next.getMonth()).toBe(3);
    expect(next.getFullYear()).toBe(2026);
  });
});

describe('snapToSlot', () => {
  it('rounds to the nearest 5-minute boundary by default', () => {
    const d = snapToSlot(new Date(2026, 2, 17, 10, 7, 40));
    expect(d).toEqual(new Date(2026, 2, 17, 10, 10, 0, 0));
  });

  it('rounds down when closer to the lower boundary', () => {
    const d = snapToSlot(new Date(2026, 2, 17, 10, 12, 0));
    expect(d).toEqual(new Date(2026, 2, 17, 10, 10, 0, 0));
  });

  it('honours a custom slot size', () => {
    const d = snapToSlot(new Date(2026, 2, 17, 10, 20, 0), 15);
    expect(d).toEqual(new Date(2026, 2, 17, 10, 15, 0, 0));
  });
});

describe('moveByMinutes', () => {
  it('preserves duration and snaps the new start', () => {
    const start = new Date(2026, 2, 17, 9, 0);
    const end = new Date(2026, 2, 17, 10, 0);
    const moved = moveByMinutes(start, end, 47, 5);
    // 9:00 + 47min = 9:47 -> snaps to 9:45, duration stays 60 minutes.
    expect(moved.start).toEqual(new Date(2026, 2, 17, 9, 45));
    expect(moved.end).toEqual(new Date(2026, 2, 17, 10, 45));
  });

  it('a negative delta moves the session earlier', () => {
    const start = new Date(2026, 2, 17, 9, 0);
    const end = new Date(2026, 2, 17, 10, 30);
    const moved = moveByMinutes(start, end, -30, 5);
    expect(moved.start).toEqual(new Date(2026, 2, 17, 8, 30));
    expect(moved.end.getTime() - moved.start.getTime()).toBe(end.getTime() - start.getTime());
  });
});

describe('startOfWeek', () => {
  it('a Monday maps to itself', () => {
    const monday = new Date(2026, 2, 16);
    expect(startOfWeek(monday)).toEqual(monday);
  });

  it('a Sunday maps to the Monday six days earlier', () => {
    const sunday = new Date(2026, 2, 22);
    expect(startOfWeek(sunday)).toEqual(new Date(2026, 2, 16));
  });
});

describe('weekdayLabel', () => {
  it('labels a Tuesday in Turkish', () => {
    expect(weekdayLabel(new Date(2026, 2, 17))).toBe('Salı');
  });

  it('labels a Sunday in Turkish', () => {
    expect(weekdayLabel(new Date(2026, 2, 22))).toBe('Pazar');
  });
});
