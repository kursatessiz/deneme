import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { StripePaymentProvider } from './stripe-payment.provider';

const configWith = (values: Record<string, string | undefined>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const checkout = {
  studioId: 's1',
  memberId: 'm1',
  amount: 100,
  currency: 'EUR',
  installmentCount: 1,
  description: 'test',
  reference: 'ref-1',
};

describe('StripePaymentProvider without credentials', () => {
  it('simulates success outside production', async () => {
    const provider = new StripePaymentProvider(configWith({ NODE_ENV: 'test' }));
    await expect(provider.createCheckout(checkout)).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('refuses every money movement in production instead of simulating success', async () => {
    const provider = new StripePaymentProvider(configWith({ NODE_ENV: 'production' }));
    await expect(provider.createCheckout(checkout)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      provider.chargeStoredCard({ ...checkout, cardToken: 'cus_1:pm_1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      provider.refund({ studioId: 's1', providerReference: 'pi_1', amount: 10, currency: 'EUR', reason: 'x' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
