import { Injectable } from '@nestjs/common';
import { randomUUID, createHmac } from 'crypto';
import { PaymentProvider } from '@platform/database';
import type { ProviderChargeResult, ProviderCheckoutResult } from '@platform/shared';
import type {
  ChargeStoredCardParams,
  CreateCheckoutParams,
  PaymentProviderAdapter,
  RefundParams,
  WebhookVerificationResult,
} from './payment-provider.interface';

/** Test card tokens ending in this suffix always decline, so e2e specs can exercise the failure path. */
export const MOCK_DECLINE_CARD_SUFFIX = '0002';
const MOCK_WEBHOOK_SECRET = 'mock-webhook-secret';

/**
 * Deterministic in-process provider used by default and in tests. No network
 * calls, no external state: every checkout and charge resolves synchronously.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly name = PaymentProvider.MOCK;

  async createCheckout(params: CreateCheckoutParams): Promise<ProviderCheckoutResult> {
    return {
      providerReference: `mock_chk_${randomUUID()}`,
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
    return {
      success: true,
      providerReference: `mock_chg_${randomUUID()}`,
    };
  }

  async refund(params: RefundParams): Promise<ProviderChargeResult> {
    return {
      success: true,
      providerReference: `mock_rfnd_${randomUUID()}`,
    };
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
