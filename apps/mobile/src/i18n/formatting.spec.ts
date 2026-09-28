import { formatCurrency, formatDate, formatNumber, formatTime } from './formatting';

describe('formatting helpers', () => {
  const sample = new Date('2026-03-05T14:30:00Z');

  it('formats a date using the given locale', () => {
    expect(formatDate(sample, 'en-US', { year: 'numeric', month: 'short', day: '2-digit' })).toMatch(/2026/);
    expect(formatDate('2026-03-05', 'tr')).toContain('2026');
  });

  it('formats a time using the given locale', () => {
    expect(formatTime(sample, 'tr')).toMatch(/\d{2}:\d{2}/);
  });

  it('formats a number honoring the locale grouping', () => {
    expect(formatNumber(1234.5, 'en-US')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'tr')).toBe('1.234,5');
  });

  it('formats currency with the requested currency code', () => {
    expect(formatCurrency(10, 'tr', 'TRY', { maximumFractionDigits: 0 })).toContain('10');
  });

  it('falls back instead of throwing for an unknown locale tag', () => {
    expect(() => formatDate(sample, 'not-a-locale')).not.toThrow();
    expect(() => formatNumber(5, 'not-a-locale')).not.toThrow();
  });
});
