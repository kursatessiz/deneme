import { Prisma } from '@platform/database';
import { cashInOf } from './cash-in';

describe('cashInOf', () => {
  it('subtracts the gift card part from the payment amount', () => {
    expect(cashInOf({ amount: new Prisma.Decimal('200.00'), giftCardAmount: new Prisma.Decimal('75.50') }).toFixed(2)).toBe('124.50');
  });

  it('treats missing sums as zero', () => {
    expect(cashInOf({ amount: null, giftCardAmount: null }).toFixed(2)).toBe('0.00');
    expect(cashInOf({ amount: new Prisma.Decimal('10') }).toFixed(2)).toBe('10.00');
  });
});
