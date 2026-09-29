import { Injectable } from '@nestjs/common';
import { randomUUID, createHmac } from 'crypto';
import { PaymentProvider } from '@platform/database';
import { amountToMinor, minorToAmount } from '@platform/shared';
import type { ProviderChargeResult, ProviderCheckoutResult } from '@platform/shared';
import type {
  ChargeStoredCardParams,
  CreateCheckoutParams,
  ListPayoutItemsParams,
  ListPayoutsParams,
  PaymentProviderAdapter,
  ProviderPayout,
  ProviderPayoutItem,
  RefundParams,
  WebhookVerificationResult,
} from './payment-provider.interface';

/** Test card tokens ending in this suffix always decline, so e2e specs can exercise the failure path. */
export const MOCK_DECLINE_CARD_SUFFIX = '0002';
const MOCK_WEBHOOK_SECRET = 'mock-webhook-secret';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Newest entries kept per studio, so a long-running dev server never grows the ledger without bound. */
const MOCK_LEDGER_MAX_ENTRIES = 2000;
/** The mock provider's fee: 2.9 percent of a charge, rounded half up in minor units. */
const MOCK_FEE_PERMILLE = 29n;

/** A charge or refund the mock provider processed, kept so it can later "pay out" (G5d-2). */
export interface MockLedgerEntry {
  studioId: string;
  type: 'CHARGE' | 'REFUND';
  /** The charge id, or the refund id for a refund. */
  reference: string;
  /** The original charge of a refund. */
  relatedReference: string | null;
  /** Positive amount in `currency` (decimal). */
  amount: number;
  currency: string;
  at: Date;
}

const mockLedger = new Map<string, MockLedgerEntry[]>();

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Fee of a mock charge in minor units (half up). */
function mockFeeMinor(amountMinor: bigint): bigint {
  return (amountMinor * MOCK_FEE_PERMILLE + 500n) / 1000n;
}

interface MockPayoutGroup {
  payout: ProviderPayout;
  items: ProviderPayoutItem[];
}

/**
 * Deterministic in-process provider used by default and in tests. No network
 * calls, no external state: every checkout and charge resolves synchronously.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly name = PaymentProvider.MOCK;

  async createCheckout(params: CreateCheckoutParams): Promise<ProviderCheckoutResult> {
    const providerReference = `mock_chk_${randomUUID()}`;
    MockPaymentProvider.recordLedger({ studioId: params.studioId, type: 'CHARGE', reference: providerReference, relatedReference: null, amount: params.amount, currency: params.currency, at: new Date() });
    return {
      providerReference,
      status: 'COMPLETED',
    };
  }

  async chargeStoredCard(params: ChargeStoredCardParams): Promise<ProviderChargeResult> {
    if (params.cardToken.endsWith(MOCK_DECLINE_CARD_SUFFIX)) {
      return {
        success: false,
        providerReference: `mock_chg_${randomUUID()}`,
        failureCode: 'card_declined',
        failureMessage: 'Kart reddedildi',
      };
    }
    const providerReference = `mock_chg_${randomUUID()}`;
    MockPaymentProvider.recordLedger({ studioId: params.studioId, type: 'CHARGE', reference: providerReference, relatedReference: null, amount: params.amount, currency: params.currency, at: new Date() });
    return {
      success: true,
      providerReference,
    };
  }

  async refund(params: RefundParams): Promise<ProviderChargeResult> {
    const providerReference = `mock_rfnd_${randomUUID()}`;
    MockPaymentProvider.recordLedger({ studioId: params.studioId, type: 'REFUND', reference: providerReference, relatedReference: params.providerReference, amount: params.amount, currency: params.currency, at: new Date() });
    return {
      success: true,
      providerReference,
    };
  }

  // ---------------------------------------------------------------------------
  // Payouts (G5d-2): the mock "pays out" what its own ledger holds, one payout
  // per UTC day and currency, arriving the next UTC midnight. Deterministic:
  // the same ledger always yields the same payout ids, items and amounts.
  // ---------------------------------------------------------------------------

  async listPayouts(params: ListPayoutsParams): Promise<ProviderPayout[]> {
    const since = startOfUtcDay(params.since).getTime();
    return this.groupsFor(params.studioId)
      .map((g) => g.payout)
      .filter((p) => p.arrivalDate.getTime() >= since);
  }

  async listPayoutItems(params: ListPayoutItemsParams): Promise<ProviderPayoutItem[]> {
    return this.groupsFor(params.studioId).find((g) => g.payout.providerPayoutId === params.providerPayoutId)?.items ?? [];
  }

  private groupsFor(studioId: string, now = new Date()): MockPayoutGroup[] {
    const today = startOfUtcDay(now).getTime();
    const buckets = new Map<string, { day: Date; currency: string; entries: MockLedgerEntry[] }>();
    for (const entry of mockLedger.get(studioId) ?? []) {
      const day = startOfUtcDay(entry.at);
      const currency = entry.currency.toUpperCase();
      const key = `${yyyymmdd(day)}:${currency}`;
      const bucket = buckets.get(key) ?? { day, currency, entries: [] };
      bucket.entries.push(entry);
      buckets.set(key, bucket);
    }
    const shortId = studioId.replace(/-/g, '').slice(0, 8);
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, bucket]) => {
        const items: ProviderPayoutItem[] = bucket.entries.map((entry) => {
          const amountMinor = amountToMinor(entry.amount.toFixed(2), bucket.currency);
          const feeMinor = entry.type === 'CHARGE' ? mockFeeMinor(amountMinor) : 0n;
          const signed = entry.type === 'CHARGE' ? amountMinor : -amountMinor;
          return {
            providerItemId: `mock_txn_${entry.reference}`,
            type: entry.type,
            providerReference: entry.reference,
            relatedReference: entry.relatedReference,
            amount: minorToAmount(signed, bucket.currency),
            fee: minorToAmount(feeMinor, bucket.currency),
            net: minorToAmount(signed - feeMinor, bucket.currency),
            currency: bucket.currency,
            occurredAt: entry.at,
            description: entry.type === 'CHARGE' ? 'Mock charge' : 'Mock refund',
          };
        });
        let net = 0n;
        for (const item of items) net += amountToMinor(item.net, bucket.currency);
        const closed = bucket.day.getTime() < today;
        return {
          payout: {
            providerPayoutId: `mock_po_${shortId}_${bucket.currency}_${yyyymmdd(bucket.day)}`,
            status: closed ? 'PAID' : 'PENDING',
            arrivalDate: new Date(bucket.day.getTime() + DAY_MS),
            netAmount: minorToAmount(net, bucket.currency),
            currency: bucket.currency,
          } satisfies ProviderPayout,
          items,
        };
      });
  }

  /** Records a processed charge or refund; the newest MOCK_LEDGER_MAX_ENTRIES per studio are kept. */
  static recordLedger(entry: MockLedgerEntry): void {
    const list = mockLedger.get(entry.studioId) ?? [];
    list.push(entry);
    if (list.length > MOCK_LEDGER_MAX_ENTRIES) list.splice(0, list.length - MOCK_LEDGER_MAX_ENTRIES);
    mockLedger.set(entry.studioId, list);
  }

  /** Test and seed helper: forgets the ledger of one studio, or of every studio. */
  static clearLedger(studioId?: string): void {
    if (studioId) mockLedger.delete(studioId);
    else mockLedger.clear();
  }

  /**
   * The mock adapter signs its own test payloads with an HMAC so
   * verifyWebhook has something real to check; a caller without the
   * matching `x-mock-signature` header is rejected just like a real
   * provider would reject a bad signature.
   */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookVerificationResult {
    const signature = headers['x-mock-signature'];
    const expected = createHmac('sha256', MOCK_WEBHOOK_SECRET).update(rawBody).digest('hex');
    if (signature !== expected) {
      return { valid: false };
    }
    try {
      const payload = JSON.parse(rawBody) as {
        eventType: WebhookVerificationResult['eventType'];
        providerReference: string;
        amount?: number;
        failureCode?: string;
      };
      return {
        valid: true,
        eventType: payload.eventType,
        providerReference: payload.providerReference,
        amount: payload.amount,
        failureCode: payload.failureCode,
      };
    } catch {
      return { valid: false };
    }
  }

  /** Test helper: signs a payload the way a real webhook sender would. */
  static sign(rawBody: string): string {
    return createHmac('sha256', MOCK_WEBHOOK_SECRET).update(rawBody).digest('hex');
  }
}
