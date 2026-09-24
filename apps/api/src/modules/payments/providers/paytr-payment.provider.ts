import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@platform/database';
import type { ProviderChargeResult, ProviderCheckoutResult } from '@platform/shared';
import type {
  ChargeStoredCardParams,
  CreateCheckoutParams,
  PaymentProviderAdapter,
  RefundParams,
  WebhookVerificationResult,
} from './payment-provider.interface';

/**
 * PayTR adapter skeleton. Real HTTP calls are not implemented; every method
 * throws a clear configuration error unless credentials are present.
 *
 * TODO(W6-follow-up): implement the real PayTR API calls.
 *   - createCheckout: POST https://www.paytr.com/odeme/api/get-token
 *       body: { merchant_id: PAYTR_MERCHANT_ID, user_ip, merchant_oid: reference,
 *               email, payment_amount, paytr_token, user_basket, ... }
 *       paytr_token = base64(hmac_sha256(merchant_id + user_ip + merchant_oid + email +
 *               payment_amount + user_basket + no_installment + max_installment +
 *               currency + test_mode, PAYTR_MERCHANT_KEY)) salted with PAYTR_MERCHANT_SALT.
 *       The result token is embedded in an iframe checkout URL; PayTR then
 *       posts a webhook (merchant_oid, status, total_amount, hash) to our callback URL.
 *   - chargeStoredCard: PayTR does not expose a direct stored-card charge API in the
 *       basic integration; subscriptions use its "recurring payment" product instead.
 *   - refund: POST https://www.paytr.com/odeme/iade
 *       body: { merchant_id, merchant_oid: providerReference, return_amount: amount }
 *   - verifyWebhook: recompute base64(hmac_sha256(merchant_oid + PAYTR_MERCHANT_SALT +
 *       status + total_amount, PAYTR_MERCHANT_KEY)) and compare to the posted hash.
 */
@Injectable()
export class PaytrPaymentProvider implements PaymentProviderAdapter {
  readonly name = PaymentProvider.PAYTR;

  constructor(private readonly config: ConfigService) {}

  private assertConfigured(): void {
    const merchantId = this.config.get<string>('PAYTR_MERCHANT_ID');
    const merchantKey = this.config.get<string>('PAYTR_MERCHANT_KEY');
    const merchantSalt = this.config.get<string>('PAYTR_MERCHANT_SALT');
    if (!merchantId || !merchantKey || !merchantSalt) {
      throw new InternalServerErrorException(
        'PayTR sağlayıcısı yapılandırılmamış: PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY ve PAYTR_MERCHANT_SALT gereklidir',
      );
    }
  }

  async createCheckout(_params: CreateCheckoutParams): Promise<ProviderCheckoutResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('PayTR entegrasyonu henüz uygulanmadı');
  }

  async chargeStoredCard(_params: ChargeStoredCardParams): Promise<ProviderChargeResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('PayTR entegrasyonu henüz uygulanmadı');
  }

  async refund(_params: RefundParams): Promise<ProviderChargeResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('PayTR entegrasyonu henüz uygulanmadı');
  }

  verifyWebhook(_headers: Record<string, string | string[] | undefined>, _rawBody: string): WebhookVerificationResult {
    this.assertConfigured();
    return { valid: false };
  }
}
