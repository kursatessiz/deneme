import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PartnerProvider } from '@platform/database';
import { PartnerProviderRegistry } from './partner-provider.registry';
import { MockPartnerProvider } from './mock-partner.provider';

const config = (env: Record<string, string>) => ({ get: (key: string) => env[key] }) as unknown as ConfigService;

const params = {
  connectionId: 'c1',
  scheduleExternalRef: 's1',
  freeSpots: 2,
  startTime: new Date(),
};
const credentials = { webhookSecret: 'whsec_test' };

describe('PartnerProviderRegistry', () => {
  it('uses the mock adapter outside production', async () => {
    const registry = new PartnerProviderRegistry(new MockPartnerProvider(), config({ NODE_ENV: 'test' }));
    const result = await registry.get(PartnerProvider.MOCK).pushAvailability(credentials, params);
    expect(result.success).toBe(true);
  });

  it('never lets the mock adapter push availability or verify a webhook in production', async () => {
    const registry = new PartnerProviderRegistry(new MockPartnerProvider(), config({ NODE_ENV: 'production' }));
    const mock = registry.get(PartnerProvider.MOCK);
    await expect(mock.pushAvailability(credentials, params)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mock.verifyWebhookSignature(credentials, '{}', 'sig', new Date().toISOString(), new Date()).valid).toBe(false);
  });

  it('every non-MOCK provider is a placeholder that refuses to push availability', async () => {
    const registry = new PartnerProviderRegistry(new MockPartnerProvider(), config({ NODE_ENV: 'test' }));
    for (const provider of [PartnerProvider.CLASSPASS, PartnerProvider.URBAN_SPORTS, PartnerProvider.WELLHUB, PartnerProvider.OTHER]) {
      await expect(registry.get(provider).pushAvailability(credentials, params)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }
  });
});
