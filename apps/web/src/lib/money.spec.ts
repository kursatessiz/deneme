import { formatMoney, formatPercent, sumMoney } from './money';

describe('formatMoney', () => {
  it('formats a decimal string as Turkish lira for the tr locale', () => {
    expect(formatMoney('1234.5', 'TRY', 'tr')).toBe('₺1.234,50');
  });

  it('formats the same amount as US dollars for the en locale', () => {
    expect(formatMoney('1234.5', 'USD', 'en')).toBe('$1,234.50');
  });

  it('formats a zero amount', () => {
    expect(formatMoney('0.00', 'TRY', 'tr')).toBe('₺0,00');
  });

  it('formats a negative decimal string (a refund)', () => {
    expect(formatMoney('-150.00', 'TRY', 'tr')).toBe('-₺150,00');
  });

  it('treats null/undefined/empty as zero instead of throwing', () => {
    expect(formatMoney(null, 'TRY', 'tr')).toBe('₺0,00');
    expect(formatMoney(undefined, 'TRY', 'tr')).toBe('₺0,00');
    expect(formatMoney('', 'TRY', 'tr')).toBe('₺0,00');
  });

  it('treats a non-numeric string as zero instead of throwing', () => {
    expect(formatMoney('not-a-number', 'TRY', 'tr')).toBe('₺0,00');
  });
});

describe('sumMoney', () => {
  it('sums decimal strings exactly (no float drift)', () => {
    // 0.1 + 0.2 famously is not 0.3 in IEEE 754 float arithmetic.
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
  });

  it('sums many small amounts without accumulating rounding error', () => {
    const amounts = Array.from({ length: 1000 }, () => '0.01');
    expect(sumMoney(amounts)).toBe('10.00');
  });

  it('handles negative amounts (refunds) correctly', () => {
    expect(sumMoney(['100.00', '-40.00'])).toBe('60.00');
  });

  it('ignores null/undefined/empty entries', () => {
    expect(sumMoney(['50.00', null, undefined, ''])).toBe('50.00');
  });

  it('returns 0.00 for an empty list', () => {
    expect(sumMoney([])).toBe('0.00');
  });

  it('pads a single-decimal or whole amount to two decimals', () => {
    expect(sumMoney(['1', '2.5'])).toBe('3.50');
  });
});

describe('formatPercent', () => {
  it('formats a 0..1 ratio as a whole-number percentage by default', () => {
    expect(formatPercent(0.4231, 'tr')).toBe('%42');
  });

  it('supports fraction digits', () => {
    expect(formatPercent(0.4231, 'tr', 1)).toBe('%42,3');
  });

  it('treats null/undefined/NaN as 0%', () => {
    expect(formatPercent(null, 'tr')).toBe('%0');
    expect(formatPercent(undefined, 'tr')).toBe('%0');
    expect(formatPercent(NaN, 'tr')).toBe('%0');
  });
});
