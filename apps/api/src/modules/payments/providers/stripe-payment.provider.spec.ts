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

describe('StripePaymentProvider webhook amounts', () => {
  const secret = 'whsec_test_secret';
  const provider = new StripePaymentProvider(configWith({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: secret }));

  // Signature checking is Stripe's own code; the fake client only parses the body.
  Reflect.set(provider, 'client', { webhooks: { constructEvent: (body: string) => JSON.parse(body) } });

  function verify(type: string, object: Record<string, unknown>) {
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type, data: { object } });
    return provider.verifyWebhook({ 'stripe-signature': 'sig' }, payload);
  }

  it('reads a zero-decimal currency (JPY) amount without dividing by 100', () => {
    const result = verify('payment_intent.succeeded', { id: 'pi_1', object: 'payment_intent', amount: 1500, currency: 'jpy' });
    expect(result).toMatchObject({ valid: true, eventType: 'CHARGE_SUCCEEDED', amount: '1500', currency: 'JPY' });
  });

  it('reads a two-decimal currency (EUR) amount from minor units', () => {
    const result = verify('payment_intent.succeeded', { id: 'pi_2', object: 'payment_intent', amount: 1550, currency: 'eur' });
    expect(result).toMatchObject({ amount: '15.50', currency: 'EUR' });
  });

  it('applies the same conversion to completed checkout sessions', () => {
    const result = verify('checkout.session.completed', { id: 'cs_1', object: 'checkout.session', amount_total: 2000, currency: 'jpy' });
    expect(result).toMatchObject({ eventType: 'CHECKOUT_COMPLETED', amount: '2000', currency: 'JPY' });
  });
});
