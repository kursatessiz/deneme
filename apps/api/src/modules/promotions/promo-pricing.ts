import { Prisma, PromoCodeKind } from '@platform/database';

export interface PromoDiscountResult {
  /** Rounded half-up to 2 decimals, never more than basePrice. */
  discountAmount: Prisma.Decimal;
  /** basePrice - discountAmount, never negative. */
  finalAmount: Prisma.Decimal;
  /** Extra units to add to the member package (FREE_UNITS kind only). */
  bonusUnits: number;
}

/**
 * Pure discount math for a promo code against a base price, shared by the
 * checkout flow and the member-facing preview endpoint. Never lets the
 * discount push the price below zero.
 */
export function computePromoDiscount(
  kind: PromoCodeKind,
  value: Prisma.Decimal.Value,
  basePrice: Prisma.Decimal.Value,
): PromoDiscountResult {
  const base = new Prisma.Decimal(basePrice).toDecimalPlaces(2);
  const promoValue = new Prisma.Decimal(value);

  if (kind === PromoCodeKind.FREE_UNITS) {
    return { discountAmount: new Prisma.Decimal(0), finalAmount: base, bonusUnits: Math.max(0, Math.round(promoValue.toNumber())) };
  }

  let discount: Prisma.Decimal;
  if (kind === PromoCodeKind.PERCENT) {
    discount = base.times(promoValue).dividedBy(100).toDecimalPlaces(2);
  } else {
    discount = promoValue.toDecimalPlaces(2);
  }
  if (discount.gt(base)) discount = base;
  if (discount.lt(0)) discount = new Prisma.Decimal(0);

  return { discountAmount: discount, finalAmount: base.minus(discount), bonusUnits: 0 };
}
