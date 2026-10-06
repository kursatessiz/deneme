import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@platform/database';
import { ProviderRegistry } from '../../../common/provider-registry';
import { MockPaymentProvider } from './mock-payment.provider';
import { IyzicoPaymentProvider } from './iyzico-payment.provider';
import { PaytrPaymentProvider } from './paytr-payment.provider';
import { StripePaymentProvider } from './stripe-payment.provider';
import type { PaymentProviderAdapter } from './payment-provider.interface';
import { apiError } from '../../../common/api-error';

const NOT_CONFIGURED = apiError('apiErrors.payments.onlinePaymentNotConfiguredYetPayments');

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
 *
 * `PAYMENT_PROVIDER` (env, existing behaviour) still picks the single
 * process-wide default every existing caller gets from `.default`. Country
 * and per-tenant selection (docs/BUYUME_VE_GLOBAL_MIMARI.md section 2.2, the
 * provider registry pattern) is available through `resolveFor` for callers
 * that know the tenant's country, without changing `.default`'s behaviour.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly adapters: Record<PaymentProvider, PaymentProviderAdapter>;
  private readonly defaultProvider: PaymentProvider;
  private readonly byCountry: ProviderRegistry<PaymentProviderAdapter>;

  constructor(
    @Inject(MockPaymentProvider) mock: MockPaymentProvider,
    @Inject(IyzicoPaymentProvider) iyzico: IyzicoPaymentProvider,
    @Inject(PaytrPaymentProvider) paytr: PaytrPaymentProvider,
    @Inject(StripePaymentProvider) stripe: StripePaymentProvider,
    config: ConfigService,
  ) {
    const isProduction = config.get<string>('NODE_ENV') === 'production';
    this.adapters = {
      [PaymentProvider.MOCK]: isProduction ? disabledMockProvider : mock,
      [PaymentProvider.IYZICO]: iyzico,
      [PaymentProvider.PAYTR]: paytr,
      [PaymentProvider.STRIPE]: stripe,
    };
    this.defaultProvider = config.get<PaymentProvider>('PAYMENT_PROVIDER', PaymentProvider.MOCK);

    // Global default: Stripe. Turkey prefers iyzico, then PayTR (matches
    // the table in docs/BUYUME_VE_GLOBAL_MIMARI.md section 2.2).
    this.byCountry = new ProviderRegistry<PaymentProviderAdapter>([
      { key: 'IYZICO', adapter: this.adapters[PaymentProvider.IYZICO], countries: ['TR'] },
      { key: 'PAYTR', adapter: this.adapters[PaymentProvider.PAYTR], countries: [] },
      { key: 'STRIPE', adapter: this.adapters[PaymentProvider.STRIPE], countries: ['*'] },
    ]);
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

  /**
   * Country-aware resolution with an optional per-tenant override (a
   * PaymentProvider key stored on the tenant's integration settings).
   * Falls back to Stripe (the global default) for any country without a
   * more specific entry.
   */
  resolveFor(countryCode: string | null | undefined, tenantOverrideKey?: string | null): PaymentProviderAdapter {
    return this.byCountry.resolveFor(countryCode, tenantOverrideKey) ?? this.adapters[PaymentProvider.STRIPE];
  }
}
