import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@platform/database';
import { MockPaymentProvider } from './mock-payment.provider';
import { IyzicoPaymentProvider } from './iyzico-payment.provider';
import { PaytrPaymentProvider } from './paytr-payment.provider';
import type { PaymentProviderAdapter } from './payment-provider.interface';

const NOT_CONFIGURED = 'Online ödeme henüz yapılandırılmadı. Nakit, kart veya havale ile ödeme alınabilir.';

/**
 * Stands in for the mock provider in production: the mock completes every
 * checkout and signs webhooks with a public secret, so it must never move
 * real entitlements. Every call fails and webhooks never verify.
 */
const disabledMockProvider: PaymentProviderAdapter = {
  name: PaymentProvider.MOCK,
  createCheckout: () => Promise.reject(new ServiceUnavailableException(NOT_CONFIGURED)),
  chargeStoredCard: () => Promise.reject(new ServiceUnavailableException(NOT_CONFIGURED)),
  refund: () => Promise.reject(new ServiceUnavailableException(NOT_CONFIGURED)),
  verifyWebhook: () => ({ valid: false }),
};

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

/**
 * Holds every adapter and resolves the tenant's active one. The webhook
 * endpoint also uses this to pick the adapter matching the URL's provider
 * segment, since a webhook can arrive from any configured provider
 * regardless of which one is the studio's default.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly adapters: Record<PaymentProvider, PaymentProviderAdapter>;
  private readonly defaultProvider: PaymentProvider;

  constructor(
    @Inject(MockPaymentProvider) mock: MockPaymentProvider,
    @Inject(IyzicoPaymentProvider) iyzico: IyzicoPaymentProvider,
    @Inject(PaytrPaymentProvider) paytr: PaytrPaymentProvider,
    config: ConfigService,
  ) {
    const isProduction = config.get<string>('NODE_ENV') === 'production';
    this.adapters = {
      [PaymentProvider.MOCK]: isProduction ? disabledMockProvider : mock,
      [PaymentProvider.IYZICO]: iyzico,
      [PaymentProvider.PAYTR]: paytr,
    };
    this.defaultProvider = config.get<PaymentProvider>('PAYMENT_PROVIDER', PaymentProvider.MOCK);
  }

  get default(): PaymentProviderAdapter {
    return this.adapters[this.defaultProvider];
  }

  get(provider: PaymentProvider): PaymentProviderAdapter {
    return this.adapters[provider];
  }

  byName(name: string): PaymentProviderAdapter | null {
    const key = name.toUpperCase() as PaymentProvider;
    return this.adapters[key] ?? null;
  }
}
