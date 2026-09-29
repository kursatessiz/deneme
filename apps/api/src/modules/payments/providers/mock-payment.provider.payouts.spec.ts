import { MockPaymentProvider } from './mock-payment.provider';

const STUDIO = '11111111-2222-3333-4444-555555555555';
const OTHER_STUDIO = '99999999-2222-3333-4444-555555555555';
const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

const checkout = (studioId: string, amount: number, currency = 'EUR') => ({
  studioId,
  memberId: 'm1',
  amount,
  currency,
  installmentCount: 1,
  description: 'test',
  reference: 'ref',
});

describe('MockPaymentProvider payouts', () => {
  let provider: MockPaymentProvider;

  beforeEach(() => {
    MockPaymentProvider.clearLedger();
    provider = new MockPaymentProvider();
  });

  it('has no payouts before anything was processed', async () => {
    await expect(provider.listPayouts({ studioId: STUDIO, since })).resolves.toEqual([]);
  });

  it('groups a day of charges and refunds into one pending payout with a 2.9 percent fee', async () => {
    const chk = await provider.createCheckout(checkout(STUDIO, 100));
    const chg = await provider.chargeStoredCard({ ...checkout(STUDIO, 50), cardToken: 'tok_1' });
    const refund = await provider.refund({ studioId: STUDIO, providerReference: chg.providerReference, amount: 20, currency: 'EUR', reason: 'x' });

    const payouts = await provider.listPayouts({ studioId: STUDIO, since });
    expect(payouts).toHaveLength(1);
    const [payout] = payouts;
    expect(payout.status).toBe('PENDING');
    expect(payout.currency).toBe('EUR');
    // 100 - 2.90 + 50 - 1.45 - 20 = 125.65
    expect(payout.netAmount).toBe('125.65');

    const items = await provider.listPayoutItems({ studioId: STUDIO, providerPayoutId: payout.providerPayoutId });
    expect(items.map((i) => i.type)).toEqual(['CHARGE', 'CHARGE', 'REFUND']);
    expect(items[0]).toMatchObject({ providerReference: chk.providerReference, amount: '100.00', fee: '2.90', net: '97.10', currency: 'EUR' });
    expect(items[2]).toMatchObject({ providerReference: refund.providerReference, relatedReference: chg.providerReference, amount: '-20.00', fee: '0.00', net: '-20.00' });
  });

  it('is deterministic: the same ledger yields the same ids and amounts', async () => {
    await provider.createCheckout(checkout(STUDIO, 10));
    const first = await provider.listPayouts({ studioId: STUDIO, since });
    const second = await provider.listPayouts({ studioId: STUDIO, since });
    expect(second).toEqual(first);
    const itemsA = await provider.listPayoutItems({ studioId: STUDIO, providerPayoutId: first[0].providerPayoutId });
    const itemsB = await provider.listPayoutItems({ studioId: STUDIO, providerPayoutId: first[0].providerPayoutId });
    expect(itemsB).toEqual(itemsA);
  });

  it('keeps currencies in separate payouts and never mixes studios', async () => {
    await provider.createCheckout(checkout(STUDIO, 10, 'EUR'));
    await provider.createCheckout(checkout(STUDIO, 1000, 'JPY'));
    await provider.createCheckout(checkout(OTHER_STUDIO, 99, 'EUR'));

    const payouts = await provider.listPayouts({ studioId: STUDIO, since });
    expect(payouts.map((p) => p.currency).sort()).toEqual(['EUR', 'JPY']);
    expect(payouts.find((p) => p.currency === 'JPY')?.netAmount).toBe('971');
    const other = await provider.listPayouts({ studioId: OTHER_STUDIO, since });
    expect(other).toHaveLength(1);
    // A payout id of one studio yields nothing for another.
    await expect(provider.listPayoutItems({ studioId: OTHER_STUDIO, providerPayoutId: payouts[0].providerPayoutId })).resolves.toEqual([]);
  });

  it('marks a past day PAID and honours the since filter', async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    MockPaymentProvider.recordLedger({ studioId: STUDIO, type: 'CHARGE', reference: 'mock_chg_old', relatedReference: null, amount: 40, currency: 'EUR', at: past });
    const all = await provider.listPayouts({ studioId: STUDIO, since });
    expect(all[0].status).toBe('PAID');
    expect(await provider.listPayouts({ studioId: STUDIO, since: new Date() })).toEqual([]);
  });

  it('bounds the ledger per studio', async () => {
    for (let i = 0; i < 2100; i++) {
      MockPaymentProvider.recordLedger({ studioId: STUDIO, type: 'CHARGE', reference: `mock_chg_${i}`, relatedReference: null, amount: 1, currency: 'EUR', at: new Date() });
    }
    const [payout] = await provider.listPayouts({ studioId: STUDIO, since });
    const items = await provider.listPayoutItems({ studioId: STUDIO, providerPayoutId: payout.providerPayoutId });
    expect(items).toHaveLength(2000);
    expect(items[0].providerReference).toBe('mock_chg_100');
  });
});
