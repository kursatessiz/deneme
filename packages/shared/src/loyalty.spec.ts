import {
  CreateLoyaltyRewardSchema,
  CreateLoyaltyRuleSchema,
  LoyaltyAdjustSchema,
  UpdateLoyaltySettingsSchema,
  addMonthsUtc,
  expiringWithin,
  lotsToExpire,
  purchaseAmountPoints,
  remainingLots,
} from './loyalty';

const d = (iso: string) => new Date(iso);

describe('purchaseAmountPoints', () => {
  const rule = { points: 2, perAmount: 50, currency: 'EUR' };

  it('gives points per whole amount in the same currency only', () => {
    expect(purchaseAmountPoints({ amount: 275, currency: 'EUR' }, rule)).toBe(10);
    expect(purchaseAmountPoints({ amount: 49.99, currency: 'EUR' }, rule)).toBe(0);
    expect(purchaseAmountPoints({ amount: 275, currency: 'USD' }, rule)).toBe(0);
    expect(purchaseAmountPoints({ amount: 0.3, currency: 'EUR' }, { points: 1, perAmount: 0.1, currency: 'EUR' })).toBe(3);
  });

  it('ignores incomplete rules and non-positive amounts', () => {
    expect(purchaseAmountPoints({ amount: 100, currency: 'EUR' }, { points: 1, perAmount: null, currency: 'EUR' })).toBe(0);
    expect(purchaseAmountPoints({ amount: -100, currency: 'EUR' }, rule)).toBe(0);
  });
});

describe('addMonthsUtc', () => {
  it('clamps to the last day of the target month', () => {
    expect(addMonthsUtc(d('2026-01-31T10:00:00.000Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonthsUtc(d('2026-11-15T00:00:00.000Z'), 3).toISOString()).toBe('2027-02-15T00:00:00.000Z');
  });
});

describe('FIFO lots', () => {
  const rows = [
    { id: 'a', delta: 100, expiresAt: d('2026-03-01T00:00:00.000Z'), createdAt: d('2026-01-01T00:00:00.000Z') },
    { id: 'b', delta: 50, expiresAt: d('2026-05-01T00:00:00.000Z'), createdAt: d('2026-02-01T00:00:00.000Z') },
    { id: 'n', delta: 40, expiresAt: null, createdAt: d('2025-12-01T00:00:00.000Z') },
    { id: 'spend', delta: -130, expiresAt: null, createdAt: d('2026-02-10T00:00:00.000Z') },
  ];

  it('consumes the soonest-expiring lots first and never-expiring lots last', () => {
    expect(remainingLots(rows).map((l) => [l.id, l.remaining])).toEqual([
      ['a', 0],
      ['b', 20],
      ['n', 40],
    ]);
  });

  it('expires only lots past their date with points left', () => {
    expect(lotsToExpire(rows, d('2026-04-01T00:00:00.000Z'))).toEqual([]);
    expect(lotsToExpire(rows, d('2026-05-02T00:00:00.000Z')).map((l) => [l.id, l.remaining])).toEqual([['b', 20]]);
    const afterExpiry = [...rows, { id: 'x', delta: -20, expiresAt: null, createdAt: d('2026-05-02T00:00:00.000Z') }];
    expect(lotsToExpire(afterExpiry, d('2026-05-03T00:00:00.000Z'))).toEqual([]);
  });

  it('sums what expires within a notice window', () => {
    expect(expiringWithin(rows, d('2026-04-20T00:00:00.000Z'), d('2026-05-04T00:00:00.000Z'))).toEqual({
      points: 20,
      firstExpiresAt: d('2026-05-01T00:00:00.000Z'),
    });
    expect(expiringWithin(rows, d('2026-01-20T00:00:00.000Z'), d('2026-02-01T00:00:00.000Z')).points).toBe(0);
  });
});

describe('loyalty contracts', () => {
  it('requires amount and currency for a purchase rule', () => {
    expect(CreateLoyaltyRuleSchema.safeParse({ kind: 'PURCHASE_AMOUNT', name: 'x', points: 1 }).success).toBe(false);
    expect(CreateLoyaltyRuleSchema.safeParse({ kind: 'PURCHASE_AMOUNT', name: 'x', points: 1, perAmount: 10, currency: 'EUR' }).success).toBe(true);
    expect(CreateLoyaltyRuleSchema.safeParse({ kind: 'ATTENDANCE', name: 'x', points: 0 }).success).toBe(false);
  });

  it('validates reward values per type', () => {
    expect(CreateLoyaltyRewardSchema.safeParse({ type: 'DISCOUNT_PERCENT', name: 'x', costPoints: 10, value: 101 }).success).toBe(false);
    expect(CreateLoyaltyRewardSchema.safeParse({ type: 'DISCOUNT_AMOUNT', name: 'x', costPoints: 10, value: 5 }).success).toBe(false);
    expect(CreateLoyaltyRewardSchema.safeParse({ type: 'DISCOUNT_AMOUNT', name: 'x', costPoints: 10, value: 5, currency: 'EUR' }).success).toBe(true);
    expect(CreateLoyaltyRewardSchema.safeParse({ type: 'EXTRA_SESSION_CREDIT', name: 'x', costPoints: 10, value: 1.5 }).success).toBe(false);
    expect(CreateLoyaltyRewardSchema.safeParse({ type: 'GIFT', name: 'x', costPoints: 10 }).success).toBe(true);
  });

  it('rejects a zero adjustment and a month policy without months', () => {
    expect(LoyaltyAdjustSchema.safeParse({ points: 0, note: 'x' }).success).toBe(false);
    expect(LoyaltyAdjustSchema.safeParse({ points: -5, note: 'x' }).success).toBe(true);
    expect(UpdateLoyaltySettingsSchema.safeParse({ expiryMode: 'MONTHS_AFTER_EARN' }).success).toBe(false);
    expect(UpdateLoyaltySettingsSchema.safeParse({ expiryMode: 'MONTHS_AFTER_EARN', expiryMonths: 12 }).success).toBe(true);
  });
});
