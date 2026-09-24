import { addDays, dayRange, startOfDay, weekRange } from './dateRange';

describe('startOfDay', () => {
  it('zeroes the time-of-day', () => {
    const d = startOfDay(new Date('2026-03-15T13:45:30.000Z'));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });
});

describe('addDays', () => {
  it('advances the calendar day without mutating the input', () => {
    const start = new Date('2026-03-15T10:00:00.000Z');
    const next = addDays(start, 3);
    expect(next.getDate()).toBe(start.getDate() + 3);
    expect(start.getDate()).toBe(15);
  });
});

describe('dayRange', () => {
  it('spans exactly one day', () => {
    const { start, end } = dayRange(new Date('2026-03-15T10:00:00.000Z'));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('weekRange', () => {
  it('spans exactly seven days', () => {
    const { start, end } = weekRange(new Date('2026-03-15T10:00:00.000Z'));
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
