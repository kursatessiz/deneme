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
 * iyzico adapter skeleton. Real HTTP calls are not implemented; every method
 * throws a clear configuration error unless credentials are present, and the
 * request shapes below are documented for whoever wires the live
 * integration in a follow-up PR.
 *
 * TODO(W6-follow-up): implement the real iyzico Payment API calls.
 *   - createCheckout: POST {IYZICO_BASE_URL}/payment/iyzipos/checkoutform/initialize/auth/ecom
 *       body: { locale, conversationId, price, paidPrice, currency, basketId,
 *               paymentGroup: 'SUBSCRIPTION' | 'PRODUCT', callbackUrl,
 *               buyer, shippingAddress, billingAddress, basketItems }
 *       auth: iyzico HMACSHA256 request signature built from IYZICO_API_KEY / IYZICO_SECRET_KEY.
 *   - chargeStoredCard: POST {IYZICO_BASE_URL}/payment/auth
 *       body: { paymentCard: { cardUserKey, cardToken }, installment, price, paidPrice, currency, basketItems }
 *   - refund: POST {IYZICO_BASE_URL}/payment/refund
 *       body: { paymentTransactionId: providerReference, price: amount, currency, ip }
 *   - verifyWebhook: iyzico signs callback params with IYZICO_SECRET_KEY; recompute and compare.
 */
@Injectable()
export class IyzicoPaymentProvider implements PaymentProviderAdapter {
  readonly name = PaymentProvider.IYZICO;

  constructor(private readonly config: ConfigService) {}

  private assertConfigured(): void {
    const apiKey = this.config.get<string>('IYZICO_API_KEY');
    const secretKey = this.config.get<string>('IYZICO_SECRET_KEY');
    if (!apiKey || !secretKey) {
      throw new InternalServerErrorException(
        'iyzico sağlayıcısı yapılandırılmamış: IYZICO_API_KEY ve IYZICO_SECRET_KEY gereklidir',
      );
    }
  }

  async createCheckout(_params: CreateCheckoutParams): Promise<ProviderCheckoutResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('iyzico entegrasyonu henüz uygulanmadı');
  }

  async chargeStoredCard(_params: ChargeStoredCardParams): Promise<ProviderChargeResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('iyzico entegrasyonu henüz uygulanmadı');
  }

  async refund(_params: RefundParams): Promise<ProviderChargeResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('iyzico entegrasyonu henüz uygulanmadı');
  }

  verifyWebhook(_headers: Record<string, string | string[] | undefined>, _rawBody: string): WebhookVerificationResult {
    this.assertConfigured();
    return { valid: false };
  }
}
