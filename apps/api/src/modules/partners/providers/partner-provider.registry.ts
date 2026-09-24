import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PartnerProvider } from '@platform/database';
import { MockPartnerProvider } from './mock-partner.provider';
import { PlaceholderPartnerProvider } from './placeholder-partner.provider';
import type { PartnerProviderAdapter } from './partner-provider.interface';

const MOCK_DISABLED_MESSAGE =
  'MOCK partner sağlayıcısı üretimde kullanılamaz. Gerçek bir toplayıcı bağlantısı yapılandırın.';

/**
 * Stands in for the mock adapter in production, mirroring
 * payments/providers/payment-provider.registry.ts disabledMockProvider: the
 * mock accepts anything and signs webhooks with a credential the caller
 * controls, so it must never run against real data.
 */
const disabledMockProvider: PartnerProviderAdapter = {
  name: PartnerProvider.MOCK,
  pushAvailability: () => Promise.reject(new ServiceUnavailableException(MOCK_DISABLED_MESSAGE)),
  verifyWebhookSignature: () => ({ valid: false, reason: MOCK_DISABLED_MESSAGE }),
};

@Injectable()
export class PartnerProviderRegistry {
  private readonly adapters: Record<PartnerProvider, PartnerProviderAdapter>;

  constructor(@Inject(MockPartnerProvider) mock: MockPartnerProvider, config: ConfigService) {
    const isProduction = config.get<string>('NODE_ENV') === 'production';
    this.adapters = {
      [PartnerProvider.MOCK]: isProduction ? disabledMockProvider : mock,
      [PartnerProvider.CLASSPASS]: new PlaceholderPartnerProvider(PartnerProvider.CLASSPASS),
      [PartnerProvider.URBAN_SPORTS]: new PlaceholderPartnerProvider(PartnerProvider.URBAN_SPORTS),
      [PartnerProvider.WELLHUB]: new PlaceholderPartnerProvider(PartnerProvider.WELLHUB),
      [PartnerProvider.OTHER]: new PlaceholderPartnerProvider(PartnerProvider.OTHER),
    };
  }

  get(provider: PartnerProvider): PartnerProviderAdapter {
    return this.adapters[provider];
  }
}
