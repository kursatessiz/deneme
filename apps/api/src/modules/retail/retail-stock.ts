import { Prisma, StockMovementType } from '@platform/database';
import { defaultRetailTaxRate } from '@platform/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { retailError } from './retail.errors';

type Tx = Prisma.TransactionClient;

export interface StockChange {
  studioId: string;
  productId: string;
  branchId: string;
  /** Signed change: negative takes stock out. */
  delta: number;
  type: StockMovementType;
  /** Let the level go below zero (studio backorder setting on a sale). */
  allowNegative: boolean;
  reason?: string | null;
  reference?: string | null;
  unitCost?: Prisma.Decimal | string | null;
  saleId?: string | null;
  saleRefundId?: string | null;
  actorUserId?: string | null;
}

/**
 * The only writer of stock: changes the cached level and appends the ledger
 * row in the caller's transaction. A decrease that must not go negative is
 * one conditional UPDATE (`quantity + delta >= 0`): Postgres takes the row
 * lock and re-checks the condition after a concurrent sale commits, so two
 * checkouts racing for the last unit can never both succeed.
 */
export async function applyStockChange(tx: Tx, change: StockChange): Promise<number> {
  if (change.delta === 0) throw new Error('Stock change must not be zero');
  let after: number;
  if (change.delta < 0 && !change.allowNegative) {
    const rows = await tx.$queryRaw<{ quantity: number }[]>(Prisma.sql`
      UPDATE "stock_levels"
      SET "quantity" = "quantity" + ${change.delta}, "updated_at" = now()
      WHERE "product_id" = ${change.productId}::uuid
        AND "branch_id" = ${change.branchId}::uuid
        AND "studio_id" = ${change.studioId}::uuid
        AND "quantity" + ${change.delta} >= 0
      RETURNING "quantity"`);
    if (rows.length === 0) {
      throw retailError(change.type === StockMovementType.ADJUSTMENT ? 'RETAIL_NEGATIVE_STOCK' : 'RETAIL_INSUFFICIENT_STOCK', {
        productId: change.productId,
      });
    }
    after = rows[0].quantity;
  } else {
    const rows = await tx.$queryRaw<{ quantity: number }[]>(Prisma.sql`
      INSERT INTO "stock_levels" ("studio_id", "product_id", "branch_id", "quantity", "updated_at")
      VALUES (${change.studioId}::uuid, ${change.productId}::uuid, ${change.branchId}::uuid, ${change.delta}, now())
      ON CONFLICT ("product_id", "branch_id")
      DO UPDATE SET "quantity" = "stock_levels"."quantity" + EXCLUDED."quantity", "updated_at" = now()
      RETURNING "quantity"`);
    after = rows[0].quantity;
  }
  await tx.stockMovement.create({
    data: {
      studioId: change.studioId,
      productId: change.productId,
      branchId: change.branchId,
      type: change.type,
      quantity: change.delta,
      quantityAfter: after,
      reason: change.reason ?? null,
      reference: change.reference ?? null,
      unitCost: change.unitCost ?? null,
      saleId: change.saleId ?? null,
      saleRefundId: change.saleRefundId ?? null,
      actorUserId: change.actorUserId ?? null,
    },
  });
  return after;
}

/** Current level of one product at one branch, row-locked for the rest of the transaction (0 when never stocked). */
export async function lockedStockLevel(tx: Tx, studioId: string, productId: string, branchId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ quantity: number }[]>(Prisma.sql`
    SELECT "quantity" FROM "stock_levels"
    WHERE "product_id" = ${productId}::uuid AND "branch_id" = ${branchId}::uuid AND "studio_id" = ${studioId}::uuid
    FOR UPDATE`);
  return rows[0]?.quantity ?? 0;
}

export interface RetailTaxContext {
  currency: string;
  pricesIncludeTax: boolean;
  taxRegime: string;
  defaultLocale: string;
  timezone: string;
  /** Rate for products without their own (percent as a decimal string). */
  defaultTaxRate: string;
}

/** The studio's region settings that price and tax a sale (G1a): currency, inclusive/exclusive pricing, regime and default rate. */
export async function loadTaxContext(prisma: PrismaService | Tx, studioId: string): Promise<RetailTaxContext> {
  const studio = await prisma.studio.findUniqueOrThrow({
    where: { id: studioId },
    select: { currency: true, pricesIncludeTax: true, taxRegime: true, defaultLocale: true, timezone: true, invoiceSettings: { select: { defaultVatRate: true } } },
  });
  return {
    currency: studio.currency,
    pricesIncludeTax: studio.pricesIncludeTax,
    taxRegime: studio.taxRegime,
    defaultLocale: studio.defaultLocale,
    timezone: studio.timezone,
    defaultTaxRate: defaultRetailTaxRate(studio.taxRegime, studio.invoiceSettings ? studio.invoiceSettings.defaultVatRate.toString() : null),
  };
}
