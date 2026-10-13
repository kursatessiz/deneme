import { Prisma } from '@platform/database';

/**
 * Money that actually came in for a set of payments: the amount minus the part
 * covered by a gift card. A gift card sale is cash in once (when the card is
 * issued); spending it later settles a package without new cash, so counting
 * the full amount of the spending payment would count that money twice.
 */
export function cashInOf(sum: { amount?: Prisma.Decimal | null; giftCardAmount?: Prisma.Decimal | null }): Prisma.Decimal {
  const amount = sum.amount ? new Prisma.Decimal(sum.amount) : new Prisma.Decimal(0);
  const giftCard = sum.giftCardAmount ? new Prisma.Decimal(sum.giftCardAmount) : new Prisma.Decimal(0);
  return amount.minus(giftCard);
}
