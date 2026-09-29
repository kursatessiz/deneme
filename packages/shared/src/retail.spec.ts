import {
  AdjustStockSchema,
  CheckoutSchema,
  allocateProportionally,
  computeCartTotals,
  defaultRetailTaxRate,
  formatReceiptNumber,
  fromRetailMinor,
  isLowStock,
  lineRefundAmount,
  roundDivHalfUp,
  saleStatusAfterRefund,
  taxRateToBasisPoints,
  toRetailMinor,
} from './retail';

describe('retail money helpers', () => {
  it('parses and formats per currency minor unit', () => {
    expect(toRetailMinor('12.5', 'EUR')).toBe(1250n);
    expect(toRetailMinor('12.345', 'EUR')).toBe(1235n);
    expect(toRetailMinor('0.005', 'USD')).toBe(1n);
    expect(toRetailMinor('300', 'JPY')).toBe(300n);
    expect(toRetailMinor('300.5', 'JPY')).toBe(301n);
    expect(fromRetailMinor(1250n, 'EUR')).toBe('12.50');
    expect(fromRetailMinor(-5n, 'EUR')).toBe('-0.05');
    expect(fromRetailMinor(300n, 'JPY')).toBe('300.00');
    // Three-decimal currencies are capped at two digits like every money column.
    expect(toRetailMinor('1.234', 'KWD')).toBe(123n);
  });

  it('rounds half away from zero', () => {
    expect(roundDivHalfUp(5n, 2n)).toBe(3n);
    expect(roundDivHalfUp(-5n, 2n)).toBe(-3n);
    expect(roundDivHalfUp(4n, 3n)).toBe(1n);
  });

  it('reads tax rates as basis points', () => {
    expect(taxRateToBasisPoints('20')).toBe(2000n);
    expect(taxRateToBasisPoints(8.25)).toBe(825n);
    expect(taxRateToBasisPoints('0')).toBe(0n);
    expect(() => taxRateToBasisPoints('-1')).toThrow();
  });

  it('allocates a total exactly over weights', () => {
    const parts = allocateProportionally(100n, [1n, 1n, 1n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(parts).toEqual([34n, 33n, 33n]);
    expect(allocateProportionally(0n, [5n, 5n])).toEqual([0n, 0n]);
    expect(allocateProportionally(10n, [0n, 0n])).toEqual([0n, 0n]);
  });
});

describe('computeCartTotals', () => {
  it('extracts tax from tax-inclusive prices', () => {
    const totals = computeCartTotals({
      currency: 'TRY',
      pricesIncludeTax: true,
      lines: [{ unitPrice: '60.00', quantity: 2, taxRate: '20' }],
    });
    expect(totals.total).toBe('120.00');
    expect(totals.netTotal).toBe('100.00');
    expect(totals.taxTotal).toBe('20.00');
    expect(totals.lines[0]).toMatchObject({ listAmount: '120.00', netAmount: '100.00', taxAmount: '20.00', total: '120.00' });
  });

  it('adds tax on top of tax-exclusive prices', () => {
    const totals = computeCartTotals({
      currency: 'USD',
      pricesIncludeTax: false,
      lines: [
        { unitPrice: '9.99', quantity: 3, taxRate: '8.25' },
        { unitPrice: '2.00', quantity: 1, taxRate: '0' },
      ],
    });
    // 29.97 * 8.25% = 2.4725 -> 2.47
    expect(totals.lines[0]).toMatchObject({ netAmount: '29.97', taxAmount: '2.47', total: '32.44' });
    expect(totals.lines[1]).toMatchObject({ netAmount: '2.00', taxAmount: '0.00', total: '2.00' });
    expect(totals.total).toBe('34.44');
    expect(totals.taxTotal).toBe('2.47');
  });

  it('applies line discounts and spreads a cart discount so lines add up to the total', () => {
    const totals = computeCartTotals({
      currency: 'EUR',
      pricesIncludeTax: true,
      lines: [
        { unitPrice: '10.00', quantity: 1, taxRate: '19', discount: '1.00' },
        { unitPrice: '10.00', quantity: 2, taxRate: '7' },
      ],
      orderDiscount: '2.90',
    });
    expect(totals.subtotal).toBe('30.00');
    expect(totals.discountableAmount).toBe('29.00');
    expect(totals.discountTotal).toBe('3.90');
    expect(totals.total).toBe('26.10');
    const sum = totals.lines.reduce((s, l) => s + toRetailMinor(l.total, 'EUR'), 0n);
    expect(fromRetailMinor(sum, 'EUR')).toBe(totals.total);
    const tax = totals.lines.reduce((s, l) => s + toRetailMinor(l.taxAmount, 'EUR'), 0n);
    expect(fromRetailMinor(tax, 'EUR')).toBe(totals.taxTotal);
  });

  it('caps discounts at the amount and never goes negative', () => {
    const totals = computeCartTotals({
      currency: 'TRY',
      pricesIncludeTax: true,
      lines: [{ unitPrice: '5.00', quantity: 1, taxRate: '10', discount: '9.00' }],
      orderDiscount: '3.00',
    });
    expect(totals.total).toBe('0.00');
    expect(totals.discountTotal).toBe('5.00');
  });

  it('rounds to whole units for zero-decimal currencies', () => {
    const totals = computeCartTotals({
      currency: 'JPY',
      pricesIncludeTax: true,
      lines: [{ unitPrice: '330', quantity: 1, taxRate: '10' }],
    });
    expect(totals.total).toBe('330.00');
    expect(totals.netTotal).toBe('300.00');
    expect(totals.taxTotal).toBe('30.00');
    const odd = computeCartTotals({ currency: 'JPY', pricesIncludeTax: false, lines: [{ unitPrice: '105', quantity: 1, taxRate: '8' }] });
    // 105 * 8% = 8.4 -> 8 yen
    expect(odd.taxTotal).toBe('8.00');
    expect(odd.total).toBe('113.00');
  });

  it('refuses a non-positive quantity', () => {
    expect(() => computeCartTotals({ currency: 'TRY', pricesIncludeTax: true, lines: [{ unitPrice: '1', quantity: 0, taxRate: '0' }] })).toThrow();
  });
});

describe('refunds and status', () => {
  it('refunds proportionally and gives the last unit the exact remainder', () => {
    const base = { lineTotal: '10.00', lineQuantity: 3, currency: 'TRY' };
    const first = lineRefundAmount({ ...base, refundedQuantity: 0, refundedAmount: '0', quantity: 1 });
    expect(first).toBe('3.33');
    const second = lineRefundAmount({ ...base, refundedQuantity: 1, refundedAmount: first, quantity: 1 });
    expect(second).toBe('3.33');
    const last = lineRefundAmount({ ...base, refundedQuantity: 2, refundedAmount: '6.66', quantity: 1 });
    expect(last).toBe('3.34');
    expect(() => lineRefundAmount({ ...base, refundedQuantity: 3, refundedAmount: '10', quantity: 1 })).toThrow();
  });

  it('derives the sale status from refunded quantities', () => {
    expect(saleStatusAfterRefund([{ quantity: 2, refundedQuantity: 0 }])).toBe('COMPLETED');
    expect(saleStatusAfterRefund([{ quantity: 2, refundedQuantity: 1 }])).toBe('PARTIALLY_REFUNDED');
    expect(saleStatusAfterRefund([{ quantity: 2, refundedQuantity: 2 }, { quantity: 1, refundedQuantity: 1 }])).toBe('REFUNDED');
  });
});

describe('small helpers and schemas', () => {
  it('formats receipt numbers and low stock', () => {
    expect(formatReceiptNumber('S', 42)).toBe('S000042');
    expect(isLowStock(3, 3)).toBe(true);
    expect(isLowStock(4, 3)).toBe(false);
    expect(isLowStock(0, null)).toBe(false);
  });

  it('picks the default tax rate from the regime', () => {
    expect(defaultRetailTaxRate('NONE', '20')).toBe('0');
    expect(defaultRetailTaxRate('TR_KDV', '20')).toBe('20');
    expect(defaultRetailTaxRate('EU_VAT', null)).toBe('0');
  });

  it('validates checkout and adjustment input', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(CheckoutSchema.safeParse({ branchId: id, lines: [], paymentMethod: 'CASH' }).success).toBe(false);
    expect(CheckoutSchema.safeParse({ branchId: id, lines: [{ productId: id, quantity: 1 }], paymentMethod: 'ONLINE_STRIPE' }).success).toBe(false);
    expect(CheckoutSchema.safeParse({ branchId: id, lines: [{ productId: id, quantity: 2, discount: '1.5' }], paymentMethod: 'CASH' }).success).toBe(true);
    expect(AdjustStockSchema.safeParse({ productId: id, branchId: id, reason: 'sayim' }).success).toBe(false);
    expect(AdjustStockSchema.safeParse({ productId: id, branchId: id, delta: -2, countedQuantity: 3, reason: 'sayim' }).success).toBe(false);
    expect(AdjustStockSchema.safeParse({ productId: id, branchId: id, countedQuantity: 0, reason: 'sayim' }).success).toBe(true);
  });
});
