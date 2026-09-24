import { JOIN_WINDOW_MINUTES_BEFORE, isWithinJoinWindow } from './video';

describe('join window math', () => {
  const start = new Date('2026-01-01T10:00:00Z');
  const end = new Date('2026-01-01T11:00:00Z');

  it('rejects joining well before the window opens', () => {
    const before = new Date(start.getTime() - (JOIN_WINDOW_MINUTES_BEFORE + 1) * 60 * 1000);
    expect(isWithinJoinWindow(start, end, before)).toBe(false);
  });

  it('accepts joining exactly when the window opens', () => {
    const opensAt = new Date(start.getTime() - JOIN_WINDOW_MINUTES_BEFORE * 60 * 1000);
    expect(isWithinJoinWindow(start, end, opensAt)).toBe(true);
  });

  it('accepts joining during the session', () => {
    const mid = new Date(start.getTime() + 30 * 60 * 1000);
    expect(isWithinJoinWindow(start, end, mid)).toBe(true);
  });

  it('accepts joining exactly at the end', () => {
    expect(isWithinJoinWindow(start, end, end)).toBe(true);
  });

  it('rejects joining after the session ends', () => {
    const after = new Date(end.getTime() + 60 * 1000);
    expect(isWithinJoinWindow(start, end, after)).toBe(false);
  });
});
