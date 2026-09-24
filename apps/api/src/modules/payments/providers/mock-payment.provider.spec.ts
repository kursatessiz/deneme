import { MockPaymentProvider, MOCK_DECLINE_CARD_SUFFIX } from './mock-payment.provider';

describe('MockPaymentProvider', () => {
  let provider: MockPaymentProvider;

  beforeEach(() => {
    provider = new MockPaymentProvider();
  });

  describe('createCheckout', () => {
    it('resolves immediately with a completed status', async () => {
      const result = await provider.createCheckout({
        studioId: 's1',
        memberId: 'm1',
        amount: 100,
        currency: 'TRY',
        installmentCount: 1,
        description: 'test',
        reference: 'ref-1',
      });
      expect(result.status).toBe('COMPLETED');
      expect(result.providerReference).toMatch(/^mock_chk_/);
    });
  });

  describe('chargeStoredCard', () => {
    const baseParams = {
      studioId: 's1',
      memberId: 'm1',
      amount: 100,
      currency: 'TRY',
      installmentCount: 1,
      description: 'test',
      reference: 'ref-1',
    };

    it('succeeds for a normal card token', async () => {
      const result = await provider.chargeStoredCard({ ...baseParams, cardToken: 'card_tok_1234' });
      expect(result.success).toBe(true);
      expect(result.providerReference).toMatch(/^mock_chg_/);
    });

    it(`declines deterministically for a card token ending in ${MOCK_DECLINE_CARD_SUFFIX}`, async () => {
      const result = await provider.chargeStoredCard({ ...baseParams, cardToken: 'card_tok_0002' });
      expect(result.success).toBe(false);
      expect(result.failureCode).toBe('card_declined');
    });
  });

  describe('refund', () => {
    it('succeeds and returns a reference', async () => {
      const result = await provider.refund({
        studioId: 's1',
        providerReference: 'mock_chg_abc',
        amount: 50,
        currency: 'TRY',
        reason: 'test',
      });
      expect(result.success).toBe(true);
      expect(result.providerReference).toMatch(/^mock_rfnd_/);
    });
  });

  describe('verifyWebhook', () => {
    it('accepts a correctly signed payload', () => {
      const payload = { eventType: 'CHARGE_SUCCEEDED', providerReference: 'mock_chg_abc', amount: 100 };
      const raw = JSON.stringify(payload);
      const signature = MockPaymentProvider.sign(raw);
      const result = provider.verifyWebhook({ 'x-mock-signature': signature }, raw);
      expect(result.valid).toBe(true);
      expect(result.eventType).toBe('CHARGE_SUCCEEDED');
      expect(result.providerReference).toBe('mock_chg_abc');
    });

    it('rejects a payload with a bad or missing signature', () => {
      const payload = { eventType: 'CHARGE_SUCCEEDED', providerReference: 'mock_chg_abc' };
      const raw = JSON.stringify(payload);
      expect(provider.verifyWebhook({ 'x-mock-signature': 'not-the-right-signature' }, raw).valid).toBe(false);
      expect(provider.verifyWebhook({}, raw).valid).toBe(false);
    });

    it('rejects malformed JSON even with a matching signature', () => {
      const raw = 'not json';
      const signature = MockPaymentProvider.sign(raw);
      expect(provider.verifyWebhook({ 'x-mock-signature': signature }, raw).valid).toBe(false);
    });
  });
});
