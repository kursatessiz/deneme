import { compareKpi, previousPeriodWindow } from './compare';

describe('previousPeriodWindow', () => {
  it('returns a window of the same length immediately before the given one', () => {
    const from = new Date(Date.UTC(2026, 2, 8, 0, 0, 0, 0));
    const to = new Date(Date.UTC(2026, 2, 15, 0, 0, 0, 0));
    const previous = previousPeriodWindow({ from, to });
    expect(previous.to.getTime()).toBe(from.getTime() - 1);
    expect(previous.to.getTime() - previous.from.getTime()).toBe(to.getTime() - from.getTime());
  });

  it('never overlaps the given window', () => {
    const from = new Date(Date.UTC(2026, 0, 1));
    const to = new Date(Date.UTC(2026, 0, 31));
    const previous = previousPeriodWindow({ from, to });
    expect(previous.to.getTime()).toBeLessThan(from.getTime());
  });

  it('handles a zero-length window (from === to)', () => {
    const from = new Date(Date.UTC(2026, 5, 1));
    const previous = previousPeriodWindow({ from, to: from });
    expect(previous.to.getTime()).toBe(from.getTime() - 1);
    expect(previous.from.getTime()).toBe(previous.to.getTime());
  });
});

describe('compareKpi', () => {
  it('is neutral with no ratio when the previous value is 0', () => {
    expect(compareKpi(5, 0)).toEqual({ current: 5, previous: 0, changeRatio: null, direction: 'neutral' });
    expect(compareKpi(0, 0)).toEqual({ current: 0, previous: 0, changeRatio: null, direction: 'neutral' });
  });

  it('is up when the current value grew', () => {
    const result = compareKpi(150, 100);
    expect(result.direction).toBe('up');
    expect(result.changeRatio).toBeCloseTo(0.5);
  });

  it('is down when the current value shrank', () => {
    const result = compareKpi(80, 100);
    expect(result.direction).toBe('down');
    expect(result.changeRatio).toBeCloseTo(-0.2);
  });

  it('is neutral with a zero ratio when nothing changed', () => {
    const result = compareKpi(100, 100);
    expect(result.direction).toBe('neutral');
    expect(result.changeRatio).toBe(0);
  });
});
