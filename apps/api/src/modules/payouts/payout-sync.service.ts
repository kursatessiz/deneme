import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider, Prisma } from '@platform/database';
import { PAYOUT_PROVIDERS } from '@platform/shared';
import type { PayoutConnectionDTO, PayoutProvider, PayoutSyncResultDTO } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry';
import { PayoutNotConfiguredError } from '../payments/providers/payment-provider.interface';
import type { PaymentProviderAdapter, ProviderPayout, ProviderPayoutItem } from '../payments/providers/payment-provider.interface';
import { PayoutReconcileService } from './payout-reconcile.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** First sync reads this far back. */
export const PAYOUT_INITIAL_LOOKBACK_DAYS = 90;
/** Later syncs re-read this much before the last one, so a payout that changed status is refreshed. */
export const PAYOUT_SYNC_OVERLAP_DAYS = 7;
/** Providers used by a studio's payments within this window take part in the background sync. */
export const PAYOUT_ACTIVE_PAYMENT_DAYS = 180;
/** The background sync visits a studio and provider at most this often. */
export const PAYOUT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ITEM_INSERT_CHUNK = 500;
const TX_TIMEOUT_MS = 30_000;

function hasPayoutCapability(adapter: PaymentProviderAdapter): boolean {
  return typeof adapter.listPayouts === 'function' && typeof adapter.listPayoutItems === 'function';
}

/**
 * Pulls payouts from the payment providers into `payouts` and
 * `payout_items` (G5d-2, docs/BANKA_ODEMELERI.md). Provider-agnostic: it only
 * uses the optional payout capability of the adapter; a provider without it
 * is reported as UNSUPPORTED. Every write is an idempotent upsert keyed by
 * (studio, provider, provider payout id) and (payout, provider item id), and
 * items already stored are never rewritten, so a manual match survives every
 * later sync.
 */
@Injectable()
export class PayoutSyncService {
  private readonly logger = new Logger(PayoutSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
    private readonly reconcile: PayoutReconcileService,
  ) {}

  /** Providers shown and synced for a studio: those its payments used, those it configured, and the process default when it can pay out. */
  private async providersOf(studioId: string, includeDefault: boolean): Promise<PayoutProvider[]> {
    const [used, connections] = await Promise.all([
      this.prisma.payment.groupBy({ by: ['provider'], where: { studioId, provider: { not: null } } }),
      this.prisma.payoutConnection.findMany({ where: { studioId }, select: { provider: true } }),
    ]);
    const set = new Set<PayoutProvider>();
    for (const row of used) if (row.provider) set.add(row.provider);
    for (const row of connections) set.add(row.provider);
    if (includeDefault && hasPayoutCapability(this.registry.default)) set.add(this.registry.default.name);
    return PAYOUT_PROVIDERS.filter((p) => set.has(p));
  }

  async connections(studioId: string): Promise<PayoutConnectionDTO[]> {
    const providers = await this.providersOf(studioId, true);
    const rows = await this.prisma.payoutConnection.findMany({ where: { studioId } });
    return providers.map((provider) => {
      const adapter = this.registry.get(provider as PaymentProvider);
      const row = rows.find((r) => r.provider === provider);
      return {
        provider,
        supported: hasPayoutCapability(adapter),
        accountRequired: adapter.payoutsNeedAccountId === true,
        providerAccountId: row?.providerAccountId ?? null,
        lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null,
      };
    });
  }

  async setAccount(studioId: string, provider: PayoutProvider, providerAccountId: string | null): Promise<PayoutConnectionDTO> {
    await this.prisma.payoutConnection.upsert({
      where: { studioId_provider: { studioId, provider } },
      create: { studioId, provider, providerAccountId },
      update: { providerAccountId, lastError: null },
    });
    const all = await this.connections(studioId);
    return all.find((c) => c.provider === provider) as PayoutConnectionDTO;
  }

  /** Manual "sync now": every provider of the studio, regardless of the throttle. */
  async syncStudio(studioId: string, now = new Date()): Promise<PayoutSyncResultDTO[]> {
    const providers = await this.providersOf(studioId, true);
    const results: PayoutSyncResultDTO[] = [];
    for (const provider of providers) results.push(await this.syncProvider(studioId, provider, now));
    return results;
  }

  /**
   * Background sync (heartbeat): studios whose payments used a provider in
   * the last 180 days, or that configured one, and that were not synced for
   * the last 6 hours. Failures are recorded per connection and never stop
   * the run.
   */
  async syncDue(now = new Date(), limit = 25): Promise<{ synced: number; payouts: number; failed: number }> {
    const activeSince = new Date(now.getTime() - PAYOUT_ACTIVE_PAYMENT_DAYS * DAY_MS);
    const dueBefore = new Date(now.getTime() - PAYOUT_SYNC_INTERVAL_MS);
    const [used, connections] = await Promise.all([
      this.prisma.payment.groupBy({ by: ['studioId', 'provider'], where: { provider: { not: null }, paidAt: { gte: activeSince } } }),
      this.prisma.payoutConnection.findMany({ select: { studioId: true, provider: true, lastSyncedAt: true } }),
    ]);
    const lastSynced = new Map(connections.map((c) => [`${c.studioId}:${c.provider}`, c.lastSyncedAt]));
    const targets = new Map<string, { studioId: string; provider: PayoutProvider }>();
    for (const row of used) if (row.provider) targets.set(`${row.studioId}:${row.provider}`, { studioId: row.studioId, provider: row.provider });
    for (const row of connections) targets.set(`${row.studioId}:${row.provider}`, { studioId: row.studioId, provider: row.provider });

    const due = [...targets.entries()]
      .filter(([key]) => {
        const at = lastSynced.get(key);
        return !at || at < dueBefore;
      })
      // Never synced first, then the longest ago.
      .sort(([a], [b]) => (lastSynced.get(a)?.getTime() ?? 0) - (lastSynced.get(b)?.getTime() ?? 0))
      .slice(0, limit);

    let synced = 0;
    let payouts = 0;
    let failed = 0;
    for (const [, target] of due) {
      const result = await this.syncProvider(target.studioId, target.provider, now);
      if (result.outcome === 'SYNCED') {
        synced += 1;
        payouts += result.payouts;
      } else if (result.outcome === 'FAILED') {
        failed += 1;
      }
    }
    return { synced, payouts, failed };
  }

  async syncProvider(studioId: string, provider: PayoutProvider, now: Date): Promise<PayoutSyncResultDTO> {
    const empty = (outcome: PayoutSyncResultDTO['outcome']): PayoutSyncResultDTO => ({ provider, outcome, payouts: 0, items: 0, matched: 0 });
    const adapter = this.registry.get(provider as PaymentProvider);
    if (!hasPayoutCapability(adapter)) return empty('UNSUPPORTED');

    const connection = await this.prisma.payoutConnection.upsert({
      where: { studioId_provider: { studioId, provider } },
      create: { studioId, provider },
      update: {},
    });
    const markError = (lastError: string) =>
      this.prisma.payoutConnection.update({ where: { id: connection.id }, data: { lastError } }).catch(() => undefined);

    if (adapter.payoutsNeedAccountId && !connection.providerAccountId) {
      await markError('ACCOUNT_REQUIRED');
      return empty('NOT_CONFIGURED');
    }

    const since = connection.lastSyncedAt
      ? new Date(connection.lastSyncedAt.getTime() - PAYOUT_SYNC_OVERLAP_DAYS * DAY_MS)
      : new Date(now.getTime() - PAYOUT_INITIAL_LOOKBACK_DAYS * DAY_MS);
    const accountId = connection.providerAccountId;

    try {
      const payouts = (await adapter.listPayouts?.({ studioId, since, accountId })) ?? [];
      const result = empty('SYNCED');
      for (const payout of payouts) {
        const items = (await adapter.listPayoutItems?.({ studioId, providerPayoutId: payout.providerPayoutId, accountId })) ?? [];
        const stored = await this.storePayout(studioId, provider, payout, items, now);
        result.payouts += 1;
        result.items += items.length;
        result.matched += stored.matched;
      }
      await this.prisma.payoutConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: now, lastError: null } });
      return result;
    } catch (err) {
      if (err instanceof PayoutNotConfiguredError) {
        await markError('NOT_CONFIGURED');
        return empty('NOT_CONFIGURED');
      }
      this.logger.warn(`Payout sync failed for studio ${studioId} provider ${provider}: ${(err as Error).message}`);
      await markError('SYNC_FAILED');
      return empty('FAILED');
    }
  }

  /** Idempotent: upserts the payout row, inserts only the items not stored yet, then reconciles. */
  private async storePayout(studioId: string, provider: PayoutProvider, payout: ProviderPayout, items: readonly ProviderPayoutItem[], now: Date): Promise<{ matched: number }> {
    const currency = payout.currency.toUpperCase();
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.payout.upsert({
          where: { studioId_provider_providerPayoutId: { studioId, provider, providerPayoutId: payout.providerPayoutId } },
          create: {
            studioId,
            provider,
            providerPayoutId: payout.providerPayoutId,
            status: payout.status,
            arrivalDate: payout.arrivalDate,
            grossAmount: new Prisma.Decimal(0),
            feeAmount: new Prisma.Decimal(0),
            refundAmount: new Prisma.Decimal(0),
            netAmount: new Prisma.Decimal(payout.netAmount),
            currency,
            syncedAt: now,
          },
          update: { status: payout.status, arrivalDate: payout.arrivalDate, netAmount: new Prisma.Decimal(payout.netAmount), currency, syncedAt: now },
        });

        const existing = new Set((await tx.payoutItem.findMany({ where: { payoutId: row.id, studioId }, select: { providerItemId: true } })).map((i) => i.providerItemId));
        const fresh = items.filter((i) => !existing.has(i.providerItemId));
        for (let i = 0; i < fresh.length; i += ITEM_INSERT_CHUNK) {
          await tx.payoutItem.createMany({
            skipDuplicates: true,
            data: fresh.slice(i, i + ITEM_INSERT_CHUNK).map((item) => ({
              studioId,
              payoutId: row.id,
              providerItemId: item.providerItemId.slice(0, 120),
              type: item.type,
              providerReference: item.providerReference?.slice(0, 120) ?? null,
              relatedReference: item.relatedReference?.slice(0, 120) ?? null,
              amount: new Prisma.Decimal(item.amount),
              fee: new Prisma.Decimal(item.fee),
              net: new Prisma.Decimal(item.net),
              currency: item.currency.toUpperCase(),
              occurredAt: item.occurredAt,
              description: item.description?.slice(0, 200) ?? null,
            })),
          });
        }
        return this.reconcile.reconcile(tx, studioId, row.id);
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }
}
