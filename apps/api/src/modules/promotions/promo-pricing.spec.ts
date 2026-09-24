import { PromoCodeKind } from '@platform/database';
import { computePromoDiscount } from './promo-pricing';

describe('computePromoDiscount', () => {
  it('computes a percent discount rounded half-up to 2 decimals', () => {
    const result = computePromoDiscount(PromoCodeKind.PERCENT, 15, 1299.99);
    // 1299.99 * 0.15 = 194.9985 -> rounds half-up to 195.00
    expect(result.discountAmount.toFixed(2)).toBe('195.00');
    expect(result.finalAmount.toFixed(2)).toBe('1104.99');
    expect(result.bonusUnits).toBe(0);
  });

  it('caps a percent discount at 100% so the price never goes negative', () => {
    const result = computePromoDiscount(PromoCodeKind.PERCENT, 100, 500);
    expect(result.discountAmount.toFixed(2)).toBe('500.00');
    expect(result.finalAmount.toFixed(2)).toBe('0.00');
  });

  it('caps a fixed-amount discount at the base price', () => {
    const result = computePromoDiscount(PromoCodeKind.FIXED_AMOUNT, 999, 500);
    expect(result.discountAmount.toFixed(2)).toBe('500.00');
    expect(result.finalAmount.toFixed(2)).toBe('0.00');
  });

  it('applies a fixed amount discount below the base price normally', () => {
    const result = computePromoDiscount(PromoCodeKind.FIXED_AMOUNT, 100, 500);
    expect(result.discountAmount.toFixed(2)).toBe('100.00');
    expect(result.finalAmount.toFixed(2)).toBe('400.00');
  });

  it('free units gives bonus units and no price discount', () => {
    const result = computePromoDiscount(PromoCodeKind.FREE_UNITS, 3, 1200);
    expect(result.discountAmount.toFixed(2)).toBe('0.00');
    expect(result.finalAmount.toFixed(2)).toBe('1200.00');
    expect(result.bonusUnits).toBe(3);
  });

  it('never returns a negative discount', () => {
    const result = computePromoDiscount(PromoCodeKind.FIXED_AMOUNT, -50, 500);
    expect(result.discountAmount.toFixed(2)).toBe('0.00');
  });
});
