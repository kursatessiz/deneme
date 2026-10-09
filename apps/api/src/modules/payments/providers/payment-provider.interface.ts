import type { ProviderChargeResult, ProviderCheckoutResult } from '@platform/shared';
import { PaymentProvider } from '@platform/database';

export interface CreateCheckoutParams {
  studioId: string;
  memberId: string;
  /** Decimal amount in the given currency, e.g. 1500.00. */
  amount: number;
  currency: string;
  installmentCount: number;
  description: string;
  /** Our own idempotency key; the adapter must echo it back or derive its providerReference from it. */
  reference: string;
  /** Optional provider-side idempotency key for adapters that support one (Stripe). */
  idempotencyKey?: string;
}

export interface ChargeStoredCardParams {
  studioId: string;
  memberId: string;
  cardToken: string;
  amount: number;
  currency: string;
  installmentCount: number;
  description: string;
  reference: string;
  /**
   * Optional provider-side idempotency key. Adapters that support it (Stripe)
   * pass it through so repeating the same call cannot charge twice.
   */
  idempotencyKey?: string;
}

export interface RefundParams {
  studioId: string;
  /** The provider reference of the original charge/checkout being refunded. */
  providerReference: string;
  amount: number;
  currency: string;
  reason: string;
}

export interface WebhookVerificationResult {
  valid: boolean;
  providerReference?: string;
  eventType?: 'CHECKOUT_COMPLETED' | 'CHARGE_SUCCEEDED' | 'CHARGE_FAILED' | 'REFUND_COMPLETED';
  /** Decimal amount in `currency` (string keeps zero- and three-decimal currencies exact). */
  amount?: number | string;
  /** ISO 4217 code (upper case) the amount is expressed in. */
  currency?: string;
  failureCode?: string;
}

/** Normalised payout status; every adapter maps its own vocabulary onto these. */
export type ProviderPayoutStatus = 'PENDING' | 'IN_TRANSIT' | 'PAID' | 'FAILED' | 'CANCELED';
export type ProviderPayoutItemType = 'CHARGE' | 'REFUND' | 'FEE' | 'ADJUSTMENT';

export interface ListPayoutsParams {
  studioId: string;
  /** Payouts created or arriving at or after this moment. */
  since: Date;
  /** The studio's account at the provider (Stripe connected account id) when the provider needs one. */
  accountId?: string | null;
}

export interface ListPayoutItemsParams {
  studioId: string;
  providerPayoutId: string;
  accountId?: string | null;
}

/** A batch transfer to the studio's bank account. Amounts are decimal strings in `currency`. */
export interface ProviderPayout {
  providerPayoutId: string;
  status: ProviderPayoutStatus;
  arrivalDate: Date;
  /** The amount actually transferred (net of fees and refunds). */
  netAmount: string;
  currency: string;
}

/** One line of a payout, mapped from the provider's balance transaction or settlement row. */
export interface ProviderPayoutItem {
  providerItemId: string;
  type: ProviderPayoutItemType;
  /** The charge or refund id used to find our Payment (payments.provider_reference). */
  providerReference: string | null;
  /** A second reference to match on (the original charge of a refund, a checkout session). */
  relatedReference: string | null;
  /** Signed gross amount: charges positive, refunds and fees negative. */
  amount: string;
  /** Provider fee of this line, positive. */
  fee: string;
  net: string;
  currency: string;
  occurredAt: Date;
  description: string | null;
}

/**
 * Thrown by a payout method that cannot run yet for a fixable reason (a real
 * Stripe key without the studio's connected account). The sync records it as
 * NOT_CONFIGURED instead of a failure.
 */
export class PayoutNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutNotConfiguredError';
  }
}

/**
 * Adapter contract every payment provider implements. Card data (PAN, CVV)
 * never crosses this boundary: only opaque provider card tokens.
 */
export interface PaymentProviderAdapter {
  readonly name: PaymentProvider;

  /** Starts a hosted/online checkout. MOCK resolves immediately; real providers return a redirect URL. */
  createCheckout(params: CreateCheckoutParams): Promise<ProviderCheckoutResult>;

  /** Charges a previously tokenized card, e.g. for a card-present sale or a subscription renewal. */
  chargeStoredCard(params: ChargeStoredCardParams): Promise<ProviderChargeResult>;

  /** Refunds a prior charge, partially or fully. */
  refund(params: RefundParams): Promise<ProviderChargeResult>;

  /** Verifies an inbound webhook's signature and extracts its event. Never trust an unverified payload. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookVerificationResult;

  /**
   * OPTIONAL payout capability (G5d-2, docs/BANKA_ODEMELERI.md). An adapter
   * without both methods is reported as "not supported" by the payout sync;
   * it is never an error.
   */
  listPayouts?(params: ListPayoutsParams): Promise<ProviderPayout[]>;
  listPayoutItems?(params: ListPayoutItemsParams): Promise<ProviderPayoutItem[]>;
  /** True when a real sync needs the studio's own provider account id (Stripe Connect). */
  readonly payoutsNeedAccountId?: boolean;
}

export const PAYMENT_PROVIDER_ADAPTER = Symbol('PAYMENT_PROVIDER_ADAPTER');
