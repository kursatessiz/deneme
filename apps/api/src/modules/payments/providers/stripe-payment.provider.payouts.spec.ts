import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { PayoutNotConfiguredError } from './payment-provider.interface';
import { StripePaymentProvider, stripeMinorToDecimal } from './stripe-payment.provider';

const configWith = (values: Record<string, string | undefined>): ConfigService => ({ get: (key: string) => values[key] }) as unknown as ConfigService;

/** Async iterable standing in for Stripe's auto-paginating list. */
function listOf<T>(rows: T[]): AsyncIterable<T> & Promise<never> {
  const iterable = {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) yield row;
    },
  };
  return iterable as unknown as AsyncIterable<T> & Promise<never>;
}

const payoutRow = (patch: Partial<Stripe.Payout> = {}): Stripe.Payout =>
  ({ id: 'po_1', status: 'paid', arrival_date: 1_772_323_200, amount: 12_455, currency: 'eur', ...patch }) as Stripe.Payout;

function withClient(client: unknown, env: Record<string, string | undefined> = { STRIPE_SECRET_KEY: 'sk_test_x', NODE_ENV: 'test' }): StripePaymentProvider {
  const provider = new StripePaymentProvider(configWith(env));
  // The tests inject a fake SDK client; no network call is ever made.
  (provider as unknown as { client: unknown }).client = client;
  return provider;
}

describe('stripeMinorToDecimal', () => {
  it('honours the currency digits and signs', () => {
    expect(stripeMinorToDecimal(12_455, 'EUR')).toBe('124.55');
    expect(stripeMinorToDecimal(-2000, 'EUR')).toBe('-20.00');
    expect(stripeMinorToDecimal(5, 'USD')).toBe('0.05');
    expect(stripeMinorToDecimal(970, 'JPY')).toBe('970');
    expect(stripeMinorToDecimal(0, 'EUR')).toBe('0.00');
  });
});

describe('StripePaymentProvider payouts', () => {
  it('maps payouts and their statuses, with the connected account on every call', async () => {
    const list = jest.fn().mockReturnValue(listOf([payoutRow(), payoutRow({ id: 'po_2', status: 'in_transit', currency: 'usd' }), payoutRow({ id: 'po_3', status: 'canceled' })]));
    const provider = withClient({ payouts: { list } });

    const payouts = await provider.listPayouts({ studioId: 's1', since: new Date('2026-03-01T00:00:00Z'), accountId: 'acct_1' });

    expect(list).toHaveBeenCalledWith({ arrival_date: { gte: 1_772_323_200 }, limit: 100 }, { stripeAccount: 'acct_1' });
    expect(payouts).toEqual([
      { providerPayoutId: 'po_1', status: 'PAID', arrivalDate: new Date(1_772_323_200 * 1000), netAmount: '124.55', currency: 'EUR' },
      { providerPayoutId: 'po_2', status: 'IN_TRANSIT', arrivalDate: new Date(1_772_323_200 * 1000), netAmount: '124.55', currency: 'USD' },
      { providerPayoutId: 'po_3', status: 'CANCELED', arrivalDate: new Date(1_772_323_200 * 1000), netAmount: '124.55', currency: 'EUR' },
    ]);
  });

  it('maps balance transactions to charge, refund, fee and adjustment items with match references', async () => {
    const txns = [
      {
        id: 'txn_charge',
        type: 'charge',
        amount: 10_000,
        fee: 320,
        net: 9680,
        currency: 'eur',
        created: 1_772_000_000,
        description: 'Package',
        source: { id: 'ch_1', object: 'charge', payment_intent: 'pi_1' },
      },
      {
        id: 'txn_refund',
        type: 'refund',
        amount: -2000,
        fee: 0,
        net: -2000,
        currency: 'eur',
        created: 1_772_000_100,
        description: null,
        source: { id: 're_1', object: 'refund', payment_intent: 'pi_1', charge: 'ch_1' },
      },
      { id: 'txn_fee', type: 'stripe_fee', amount: -50, fee: 0, net: -50, currency: 'eur', created: 1_772_000_200, description: 'Fee', source: 'fee_1' },
      { id: 'txn_adj', type: 'adjustment', amount: -500, fee: 0, net: -500, currency: 'eur', created: 1_772_000_300, description: 'Dispute', source: null },
      { id: 'txn_payout', type: 'payout', amount: -11_130, fee: 0, net: -11_130, currency: 'eur', created: 1_772_000_400, description: null, source: 'po_1' },
    ];
    const balanceList = jest.fn().mockReturnValue(listOf(txns));
    const sessionsList = jest.fn().mockResolvedValue({ data: [{ id: 'cs_1' }] });
    const provider = withClient({ balanceTransactions: { list: balanceList }, checkout: { sessions: { list: sessionsList } } });

    const items = await provider.listPayoutItems({ studioId: 's1', providerPayoutId: 'po_1', accountId: 'acct_1' });

    expect(balanceList).toHaveBeenCalledWith({ payout: 'po_1', expand: ['data.source'], limit: 100 }, { stripeAccount: 'acct_1' });
    expect(sessionsList).toHaveBeenCalledWith({ payment_intent: 'pi_1', limit: 1 }, { stripeAccount: 'acct_1' });
    // The payout's own balance transaction is not an item.
    expect(items.map((i) => i.providerItemId)).toEqual(['txn_charge', 'txn_refund', 'txn_fee', 'txn_adj']);
    expect(items[0]).toMatchObject({
      type: 'CHARGE',
      providerReference: 'pi_1',
      relatedReference: 'cs_1',
      amount: '100.00',
      fee: '3.20',
      net: '96.80',
      currency: 'EUR',
      description: 'Package',
    });
    expect(items[1]).toMatchObject({ type: 'REFUND', providerReference: 're_1', relatedReference: 'pi_1', amount: '-20.00', net: '-20.00', description: null });
    expect(items[2]).toMatchObject({ type: 'FEE', providerReference: 'fee_1', amount: '-0.50' });
    expect(items[3]).toMatchObject({ type: 'ADJUSTMENT', providerReference: null, net: '-5.00' });
  });

  it('keeps the charge id as the second reference when the checkout session lookup fails', async () => {
    const balanceList = jest.fn().mockReturnValue(
      listOf([{ id: 'txn_1', type: 'payment', amount: 100, fee: 0, net: 100, currency: 'usd', created: 1_772_000_000, description: null, source: { id: 'ch_9', object: 'charge', payment_intent: 'pi_9' } }]),
    );
    const sessionsList = jest.fn().mockRejectedValue(new Error('rate limited'));
    const provider = withClient({ balanceTransactions: { list: balanceList }, checkout: { sessions: { list: sessionsList } } });

    const [item] = await provider.listPayoutItems({ studioId: 's1', providerPayoutId: 'po_1', accountId: 'acct_1' });
    expect(item).toMatchObject({ type: 'CHARGE', providerReference: 'pi_9', relatedReference: 'ch_9' });
  });

  it('refuses to read without the studio account when Stripe is configured', async () => {
    const provider = withClient({ payouts: { list: jest.fn() } });
    expect(provider.payoutsNeedAccountId).toBe(true);
    await expect(provider.listPayouts({ studioId: 's1', since: new Date(), accountId: null })).rejects.toBeInstanceOf(PayoutNotConfiguredError);
    await expect(provider.listPayoutItems({ studioId: 's1', providerPayoutId: 'po_1' })).rejects.toBeInstanceOf(PayoutNotConfiguredError);
  });

  it('without credentials: empty outside production, refused in production, and no account needed', async () => {
    const dev = new StripePaymentProvider(configWith({ NODE_ENV: 'test' }));
    expect(dev.payoutsNeedAccountId).toBe(false);
    await expect(dev.listPayouts({ studioId: 's1', since: new Date() })).resolves.toEqual([]);
    await expect(dev.listPayoutItems({ studioId: 's1', providerPayoutId: 'po_1' })).resolves.toEqual([]);

    const prod = new StripePaymentProvider(configWith({ NODE_ENV: 'production' }));
    await expect(prod.listPayouts({ studioId: 's1', since: new Date() })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
