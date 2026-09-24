import { resolveDateRangePreset, toDateInputValue, fromDateInputValue } from './date-range';

// 2026-03-17 is a Tuesday.
const NOW = new Date(2026, 2, 17, 14, 30, 0);

describe('resolveDateRangePreset', () => {
  it('today covers just the current local day', () => {
    const { from, to } = resolveDateRangePreset('today', NOW);
    expect(from).toEqual(new Date(2026, 2, 17, 0, 0, 0, 0));
    expect(to).toEqual(new Date(2026, 2, 17, 23, 59, 59, 999));
  });

  it('this_week starts on Monday', () => {
    const { from, to } = resolveDateRangePreset('this_week', NOW);
    expect(from).toEqual(new Date(2026, 2, 16, 0, 0, 0, 0));
    expect(to).toEqual(new Date(2026, 2, 17, 23, 59, 59, 999));
  });

  it('last_7_days includes today and the 6 days before it', () => {
    const { from, to } = resolveDateRangePreset('last_7_days', NOW);
    expect(from).toEqual(new Date(2026, 2, 11, 0, 0, 0, 0));
    expect(to).toEqual(new Date(2026, 2, 17, 23, 59, 59, 999));
  });

  it('this_month starts on the 1st', () => {
    const { from } = resolveDateRangePreset('this_month', NOW);
    expect(from).toEqual(new Date(2026, 2, 1, 0, 0, 0, 0));
  });

  it('last_30_days spans 30 calendar days including today', () => {
    const { from, to } = resolveDateRangePreset('last_30_days', NOW);
    expect(from).toEqual(new Date(2026, 1, 16, 0, 0, 0, 0));
    expect(to).toEqual(new Date(2026, 2, 17, 23, 59, 59, 999));
  });

  it('this_year starts on January 1st', () => {
    const { from } = resolveDateRangePreset('this_year', NOW);
    expect(from).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
  });
});

describe('date input value round trip', () => {
  it('formats and parses a local date without a UTC off-by-one', () => {
    const value = toDateInputValue(new Date(2026, 0, 5));
    expect(value).toBe('2026-01-05');
    expect(fromDateInputValue(value)).toEqual(new Date(2026, 0, 5, 0, 0, 0, 0));
  });

  it('returns null for an empty or malformed value', () => {
    expect(fromDateInputValue('')).toBeNull();
    expect(fromDateInputValue('not-a-date')).toBeNull();
  });
});
