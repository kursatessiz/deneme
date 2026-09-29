import {
  ListPayoutsQuerySchema,
  MatchPayoutItemSchema,
  PayoutExportQuerySchema,
  UpdatePayoutConnectionSchema,
  autoMatchItems,
  buildPayoutItemJournal,
  buildPayoutJournal,
  isMatchableItemType,
  itemMatchReferences,
  payoutNetDifference,
  reconciliationStatusOf,
  summarizePayoutItems,
} from './payouts';
import type { MatchableItem, PayoutAmountLine } from './payouts';

const line = (type: PayoutAmountLine['type'], amount: string, fee: string, net: string): PayoutAmountLine => ({ type, amount, fee, net });

describe('summarizePayoutItems', () => {
  it('splits gross, fees, refunds and adjustments and adds the item nets', () => {
    const totals = summarizePayoutItems(
      [
        line('CHARGE', '100.00', '3.20', '96.80'),
        line('CHARGE', '50.00', '1.75', '48.25'),
        line('REFUND', '-20.00', '0.00', '-20.00'),
        line('FEE', '-0.50', '0.00', '-0.50'),
        line('ADJUSTMENT', '-5.00', '0.00', '-5.00'),
      ],
      'EUR',
    );
    expect(totals).toEqual({ gross: '150.00', fee: '5.45', refund: '20.00', adjustments: '-5.00', itemsNet: '119.55' });
  });

  it('uses the currency digits (zero-decimal currencies print no fraction)', () => {
    const totals = summarizePayoutItems([line('CHARGE', '1000', '30', '970'), line('REFUND', '-200', '0', '-200')], 'JPY');
    expect(totals).toEqual({ gross: '1000', fee: '30', refund: '200', adjustments: '0', itemsNet: '770' });
  });

  it('is all zero for a payout without items', () => {
    expect(summarizePayoutItems([], 'USD')).toEqual({ gross: '0.00', fee: '0.00', refund: '0.00', adjustments: '0.00', itemsNet: '0.00' });
  });
});

describe('payoutNetDifference', () => {
  it('is zero when the items add up and signed otherwise', () => {
    expect(payoutNetDifference('119.55', '119.55', 'EUR')).toBe('0.00');
    expect(payoutNetDifference('120.00', '119.55', 'EUR')).toBe('0.45');
    expect(payoutNetDifference('119.00', '119.55', 'EUR')).toBe('-0.55');
  });
});

describe('reconciliationStatusOf', () => {
  it('covers every case', () => {
    expect(reconciliationStatusOf({ total: 0, matchable: 0, matched: 0 })).toBe('UNMATCHED');
    expect(reconciliationStatusOf({ total: 3, matchable: 0, matched: 0 })).toBe('MATCHED');
    expect(reconciliationStatusOf({ total: 5, matchable: 4, matched: 4 })).toBe('MATCHED');
    expect(reconciliationStatusOf({ total: 5, matchable: 4, matched: 0 })).toBe('UNMATCHED');
    expect(reconciliationStatusOf({ total: 5, matchable: 4, matched: 2 })).toBe('PARTIAL');
  });
});

const item = (id: string, patch: Partial<MatchableItem> = {}): MatchableItem => ({
  id,
  type: 'CHARGE',
  providerReference: null,
  relatedReference: null,
  currency: 'EUR',
  paymentId: null,
  matchSource: null,
  ...patch,
});

describe('itemMatchReferences', () => {
  it('lists distinct non-empty references, most specific first', () => {
    expect(itemMatchReferences({ providerReference: 'a', relatedReference: 'b' })).toEqual(['a', 'b']);
    expect(itemMatchReferences({ providerReference: 'a', relatedReference: 'a' })).toEqual(['a']);
    expect(itemMatchReferences({ providerReference: null, relatedReference: '' })).toEqual([]);
  });
});

describe('autoMatchItems', () => {
  const payments = [
    { id: 'p1', providerReference: 'pi_1', currency: 'EUR' },
    { id: 'p2', providerReference: 'cs_2', currency: 'EUR' },
    { id: 'p3', providerReference: 'dup', currency: 'EUR' },
    { id: 'p4', providerReference: 'dup', currency: 'EUR' },
    { id: 'p5', providerReference: 'usd', currency: 'USD' },
  ];

  it('matches charges by their reference and by the related reference', () => {
    const matches = autoMatchItems(
      [item('i1', { providerReference: 'pi_1' }), item('i2', { providerReference: 'pi_2', relatedReference: 'cs_2' })],
      payments,
    );
    expect(matches).toEqual([
      { itemId: 'i1', paymentId: 'p1' },
      { itemId: 'i2', paymentId: 'p2' },
    ]);
  });

  it('matches a refund through the original charge reference', () => {
    expect(autoMatchItems([item('r1', { type: 'REFUND', providerReference: 're_9', relatedReference: 'pi_1' })], payments)).toEqual([{ itemId: 'r1', paymentId: 'p1' }]);
  });

  it('leaves fees, adjustments, linked items and hand-handled items alone', () => {
    const matches = autoMatchItems(
      [
        item('fee', { type: 'FEE', providerReference: 'pi_1' }),
        item('adj', { type: 'ADJUSTMENT', providerReference: 'pi_1' }),
        item('linked', { providerReference: 'pi_1', paymentId: 'px' }),
        item('manual', { providerReference: 'pi_1', matchSource: 'MANUAL' }),
        item('removed', { providerReference: 'pi_1', matchSource: 'UNMATCHED_MANUAL' }),
      ],
      payments,
    );
    expect(matches).toEqual([]);
  });

  it('refuses an ambiguous reference and a currency mismatch', () => {
    expect(autoMatchItems([item('amb', { providerReference: 'dup' }), item('cur', { providerReference: 'usd' })], payments)).toEqual([]);
  });

  it('re-matches an automatic link whose payment is gone', () => {
    expect(autoMatchItems([item('gone', { providerReference: 'pi_1', matchSource: 'AUTO' })], payments)).toEqual([{ itemId: 'gone', paymentId: 'p1' }]);
  });
});

describe('isMatchableItemType', () => {
  it('is true for charges and refunds only', () => {
    expect(['CHARGE', 'REFUND', 'FEE', 'ADJUSTMENT'].map((t) => isMatchableItemType(t as 'CHARGE'))).toEqual([true, true, false, false]);
  });
});

describe('schemas', () => {
  it('parses the list query with defaults and bounds', () => {
    const parsed = ListPayoutsQuerySchema.parse({ provider: 'STRIPE', reconciliationStatus: 'PARTIAL' });
    expect(parsed).toMatchObject({ page: 1, pageSize: 25, provider: 'STRIPE' });
    expect(ListPayoutsQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(ListPayoutsQuerySchema.safeParse({ provider: 'PAYPAL' }).success).toBe(false);
    expect(ListPayoutsQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
  });

  it('requires a uuid to match and rejects extra keys', () => {
    expect(MatchPayoutItemSchema.safeParse({ paymentId: '3f4f9c50-27b7-4d0a-9d7f-2a7d0c0c1a11' }).success).toBe(true);
    expect(MatchPayoutItemSchema.safeParse({ paymentId: 'x' }).success).toBe(false);
    expect(MatchPayoutItemSchema.safeParse({ paymentId: '3f4f9c50-27b7-4d0a-9d7f-2a7d0c0c1a11', extra: 1 }).success).toBe(false);
  });

  it('accepts a plain account id, null, and rejects other characters or long input quickly', () => {
    expect(UpdatePayoutConnectionSchema.safeParse({ providerAccountId: 'acct_1AbC' }).success).toBe(true);
    expect(UpdatePayoutConnectionSchema.safeParse({ providerAccountId: null }).success).toBe(true);
    expect(UpdatePayoutConnectionSchema.safeParse({ providerAccountId: 'acct 1' }).success).toBe(false);
    const started = Date.now();
    expect(UpdatePayoutConnectionSchema.safeParse({ providerAccountId: `${'a'.repeat(200_000)}!` }).success).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('defaults the export to XLSX payouts over the last 90 days and caps the range', () => {
    const parsed = PayoutExportQuerySchema.parse({});
    expect(parsed).toMatchObject({ kind: 'payouts', format: 'xlsx', delimiter: 'semicolon' });
    expect(parsed.to.getTime() - parsed.from.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    expect(PayoutExportQuerySchema.safeParse({ from: '2020-01-01', to: '2022-01-01' }).success).toBe(false);
    expect(PayoutExportQuerySchema.safeParse({ format: 'json' }).success).toBe(false);
  });
});

describe('export journals', () => {
  it('builds sorted payout rows with normalised amounts', () => {
    const rows = buildPayoutJournal([
      {
        arrivalDate: new Date('2026-03-02T00:00:00Z'),
        provider: 'STRIPE',
        providerPayoutId: 'po_b',
        status: 'PAID',
        reconciliationStatus: 'MATCHED',
        itemCount: 3,
        matchedItemCount: 2,
        grossAmount: '150',
        feeAmount: '5.45',
        refundAmount: '20.00',
        netAmount: '124.55',
        currency: 'EUR',
      },
      {
        arrivalDate: new Date('2026-03-01T00:00:00Z'),
        provider: 'STRIPE',
        providerPayoutId: 'po_a',
        status: 'PAID',
        reconciliationStatus: 'UNMATCHED',
        itemCount: 0,
        matchedItemCount: 0,
        grossAmount: '0',
        feeAmount: '0',
        refundAmount: '0',
        netAmount: '0',
        currency: 'JPY',
      },
    ]);
    expect(rows.map((r) => r.providerPayoutId)).toEqual(['po_a', 'po_b']);
    expect(rows[1]).toMatchObject({ gross: '150.00', fee: '5.45', net: '124.55', itemCount: '3', currency: 'EUR' });
    expect(rows[0]).toMatchObject({ gross: '0', currency: 'JPY' });
  });

  it('builds item rows with blank optional cells', () => {
    const rows = buildPayoutItemJournal([
      {
        arrivalDate: new Date('2026-03-01T00:00:00Z'),
        provider: 'MOCK',
        providerPayoutId: 'po_a',
        type: 'REFUND',
        providerReference: null,
        occurredAt: new Date('2026-02-28T10:00:00Z'),
        amount: '-10',
        fee: '0',
        net: '-10',
        currency: 'USD',
        paymentId: null,
        receiptNumber: null,
      },
    ]);
    expect(rows[0]).toMatchObject({ type: 'REFUND', providerReference: '', amount: '-10.00', receiptNumber: '', paymentId: '' });
  });
});
