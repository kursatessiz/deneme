import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@platform/database';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { MockPaymentProvider } from './mock-payment.provider';
import type { IyzicoPaymentProvider } from './iyzico-payment.provider';
import type { PaytrPaymentProvider } from './paytr-payment.provider';
import type { StripePaymentProvider } from './stripe-payment.provider';

const config = (env: Record<string, string>) =>
  ({ get: (key: string, fallback?: string) => env[key] ?? fallback }) as unknown as ConfigService;

const build = (env: Record<string, string>) =>
  new PaymentProviderRegistry(
    new MockPaymentProvider(),
    { name: PaymentProvider.IYZICO } as IyzicoPaymentProvider,
    { name: PaymentProvider.PAYTR } as PaytrPaymentProvider,
    { name: PaymentProvider.STRIPE } as StripePaymentProvider,
    config(env),
  );

const checkout = {
  studioId: 's',
  memberId: 'm',
  amount: 100,
  currency: 'TRY',
  installmentCount: 1,
  description: 'x',
  reference: 'r',
};

describe('PaymentProviderRegistry', () => {
  it('uses the mock provider outside production', async () => {
    const registry = build({ NODE_ENV: 'development' });
    const result = await registry.default.createCheckout(checkout);
    expect(result.status).toBe('COMPLETED');
  });

  it('never lets the mock provider complete a payment in production', async () => {
    const registry = build({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'MOCK' });
    await expect(registry.default.createCheckout(checkout)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      registry.get(PaymentProvider.MOCK).chargeStoredCard({ ...checkout, cardToken: 'tok_4242' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(registry.byName('mock')?.verifyWebhook({}, '{}').valid).toBe(false);
  });

  describe('resolveFor (country-aware selection)', () => {
    const registry = build({ NODE_ENV: 'development' });

    it('picks iyzico for Turkey', () => {
      expect(registry.resolveFor('TR').name).toBe(PaymentProvider.IYZICO);
    });

    it('falls back to Stripe (the global default) for any other country', () => {
      expect(registry.resolveFor('US').name).toBe(PaymentProvider.STRIPE);
      expect(registry.resolveFor('DE').name).toBe(PaymentProvider.STRIPE);
      expect(registry.resolveFor(null).name).toBe(PaymentProvider.STRIPE);
    });

    it('a tenant override wins over the country default', () => {
      expect(registry.resolveFor('TR', 'PAYTR').name).toBe(PaymentProvider.PAYTR);
    });
  });
});
