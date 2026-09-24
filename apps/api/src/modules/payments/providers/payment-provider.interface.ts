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
  amount?: number;
  failureCode?: string;
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
}

export const PAYMENT_PROVIDER_ADAPTER = Symbol('PAYMENT_PROVIDER_ADAPTER');
