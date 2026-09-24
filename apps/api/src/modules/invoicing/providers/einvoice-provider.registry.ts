import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EInvoiceProvider } from '@platform/database';
import { MockEInvoiceProvider } from './mock-einvoice.provider';
import { ParasutEInvoiceProvider } from './parasut-einvoice.provider';
import { ElogoEInvoiceProvider } from './elogo-einvoice.provider';
import { ForibaEInvoiceProvider } from './foriba-einvoice.provider';
import { UyumsoftEInvoiceProvider } from './uyumsoft-einvoice.provider';
import type { EInvoiceProviderAdapter } from './einvoice-provider.interface';

const NOT_CONFIGURED = 'e-Fatura sağlayıcısı henüz yapılandırılmadı.';

/**
 * Stands in for the mock provider in production: MOCK "issues" every
 * invoice instantly with no legal effect, so it must never run against
 * real studio data once the app is live. Every call fails.
 */
const disabledMockProvider: EInvoiceProviderAdapter = {
  name: EInvoiceProvider.MOCK,
  issue: () => Promise.reject(new ServiceUnavailableException(NOT_CONFIGURED)),
  cancel: () => Promise.reject(new ServiceUnavailableException(NOT_CONFIGURED)),
  getStatus: () => Promise.reject(new ServiceUnavailableException(NOT_CONFIGURED)),
  getPdf: () => Promise.reject(new ServiceUnavailableException(NOT_CONFIGURED)),
};

/**
 * Holds every e-invoice adapter and resolves a studio's configured one, the
 * same shape as PaymentProviderRegistry. Each studio picks its provider
 * through InvoiceSettings; provider credentials still come from env vars.
 */
@Injectable()
export class EInvoiceProviderRegistry {
  private readonly adapters: Record<EInvoiceProvider, EInvoiceProviderAdapter>;

  constructor(
    @Inject(MockEInvoiceProvider) mock: MockEInvoiceProvider,
    @Inject(ParasutEInvoiceProvider) parasut: ParasutEInvoiceProvider,
    @Inject(ElogoEInvoiceProvider) elogo: ElogoEInvoiceProvider,
    @Inject(ForibaEInvoiceProvider) foriba: ForibaEInvoiceProvider,
    @Inject(UyumsoftEInvoiceProvider) uyumsoft: UyumsoftEInvoiceProvider,
    config: ConfigService,
  ) {
    const isProduction = config.get<string>('NODE_ENV') === 'production';
    this.adapters = {
      [EInvoiceProvider.MOCK]: isProduction ? disabledMockProvider : mock,
      [EInvoiceProvider.PARASUT]: parasut,
      [EInvoiceProvider.ELOGO]: elogo,
      [EInvoiceProvider.FORIBA]: foriba,
      [EInvoiceProvider.UYUMSOFT]: uyumsoft,
    };
  }

  get(provider: EInvoiceProvider): EInvoiceProviderAdapter {
    return this.adapters[provider];
  }
}
