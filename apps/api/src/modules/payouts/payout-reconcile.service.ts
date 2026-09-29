import { Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { autoMatchItems, isMatchableItemType, itemMatchReferences, reconciliationStatusOf, summarizePayoutItems } from '@platform/shared';
import type { MatchableItem, PayoutItemTypeValue, PayoutMatchSourceValue } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Prisma client or an open transaction: reconciliation runs inside the caller's transaction when there is one. */
export type PrismaClientLike = PrismaService | Prisma.TransactionClient;

const UPDATE_CHUNK = 50;

/**
 * Reconciliation of one payout (G5d-2, docs/BANKA_ODEMELERI.md): links its
 * unmatched charge and refund items to payments by provider reference (pure
 * rules in `autoMatchItems`), then recomputes the payout's totals, item
 * counts and reconciliation status from its items. Idempotent, and it never
 * touches a link a person made or removed by hand. Every query filters by
 * studioId.
 */
@Injectable()
export class PayoutReconcileService {
  async reconcile(db: PrismaClientLike, studioId: string, payoutId: string): Promise<{ matched: number }> {
    const payout = await db.payout.findFirst({ where: { id: payoutId, studioId }, select: { id: true, provider: true, currency: true } });
    if (!payout) return { matched: 0 };
    const items = await db.payoutItem.findMany({ where: { payoutId, studioId } });

    const matchable: MatchableItem[] = items.map((i) => ({
      id: i.id,
      type: i.type as PayoutItemTypeValue,
      providerReference: i.providerReference,
      relatedReference: i.relatedReference,
      currency: i.currency,
      paymentId: i.paymentId,
      matchSource: i.matchSource as PayoutMatchSourceValue | null,
    }));

    const wanted = new Set<string>();
    for (const item of matchable) {
      if (!isMatchableItemType(item.type) || item.paymentId || item.matchSource === 'MANUAL' || item.matchSource === 'UNMATCHED_MANUAL') continue;
      for (const ref of itemMatchReferences(item)) wanted.add(ref);
    }
    const payments = wanted.size
      ? await db.payment.findMany({
          where: { studioId, provider: payout.provider, providerReference: { in: [...wanted] } },
          select: { id: true, providerReference: true, currency: true },
        })
      : [];

    const matches = autoMatchItems(matchable, payments);
    for (let i = 0; i < matches.length; i += UPDATE_CHUNK) {
      await Promise.all(
        matches.slice(i, i + UPDATE_CHUNK).map((m) =>
          db.payoutItem.updateMany({ where: { id: m.itemId, studioId, paymentId: null }, data: { paymentId: m.paymentId, matchSource: 'AUTO' } }),
        ),
      );
    }
    const linked = new Map(matches.map((m) => [m.itemId, m.paymentId]));

    const lines = items.map((i) => ({ type: i.type as PayoutItemTypeValue, amount: i.amount.toFixed(2), fee: i.fee.toFixed(2), net: i.net.toFixed(2) }));
    const totals = summarizePayoutItems(lines, payout.currency);
    let matchableCount = 0;
    let matchedCount = 0;
    for (const item of items) {
      if (!isMatchableItemType(item.type as PayoutItemTypeValue)) continue;
      matchableCount += 1;
      if (item.paymentId || linked.has(item.id)) matchedCount += 1;
    }
    await db.payout.update({
      where: { id: payout.id },
      data: {
        grossAmount: new Prisma.Decimal(totals.gross),
        feeAmount: new Prisma.Decimal(totals.fee),
        refundAmount: new Prisma.Decimal(totals.refund),
        itemCount: items.length,
        matchableItemCount: matchableCount,
        matchedItemCount: matchedCount,
        reconciliationStatus: reconciliationStatusOf({ total: items.length, matchable: matchableCount, matched: matchedCount }),
      },
    });
    return { matched: matches.length };
  }
}
