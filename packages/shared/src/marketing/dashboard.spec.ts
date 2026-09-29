import {
  AI_BUDGET_WARNING_RATIO,
  DASHBOARD_ERROR_TEXT_MAX,
  DashboardQuerySchema,
  aiBudgetOf,
  buildDashboardDeltas,
  compareByCurrency,
  costPerUnit,
  emailHealthOf,
  moneyList,
  moneyToRatios,
  resolveDashboardRange,
  roasByCurrency,
  sanitizeConnectionError,
  smsHealthOf,
  summarizeTrialCohort,
} from './dashboard';
import type { DashboardBlock } from './dashboard';

const DAY = 86_400_000;

describe('costPerUnit (CAC and CPL per currency)', () => {
  const spend = [
    { currency: 'USD', amount: '300.00' },
    { currency: 'TRY', amount: '9000.00' },
  ];

  it('divides each currency by the count and never mixes currencies', () => {
    expect(costPerUnit(spend, 3, 'cac')).toEqual([
      { currency: 'TRY', amount: '3000.00' },
      { currency: 'USD', amount: '100.00' },
    ]);
    expect(costPerUnit(spend, 4, 'cpl')).toEqual([
      { currency: 'TRY', amount: '2250.00' },
      { currency: 'USD', amount: '75.00' },
    ]);
  });

  it('returns nothing when the count is zero (no division by zero)', () => {
    expect(costPerUnit(spend, 0, 'cac')).toEqual([]);
    expect(costPerUnit(spend, 0, 'cpl')).toEqual([]);
  });

  it('leaves out a currency without spend', () => {
    expect(costPerUnit([{ currency: 'EUR', amount: '0.00' }, ...spend], 2, 'cac').map((m) => m.currency)).toEqual(['TRY', 'USD']);
    expect(costPerUnit([], 5, 'cac')).toEqual([]);
  });

  it('rounds to two decimals', () => {
    expect(costPerUnit([{ currency: 'USD', amount: '100.00' }], 3, 'cac')).toEqual([{ currency: 'USD', amount: '33.33' }]);
  });
});

describe('roasByCurrency', () => {
  it('uses the revenue of the same currency and 0 when there is none', () => {
    const roas = roasByCurrency(
      [
        { currency: 'USD', amount: '600.00' },
        { currency: 'GBP', amount: '999.00' },
      ],
      [
        { currency: 'USD', amount: '300.00' },
        { currency: 'TRY', amount: '9000.00' },
      ],
    );
    expect(roas).toEqual([
      { currency: 'TRY', value: 0 },
      { currency: 'USD', value: 2 },
    ]);
  });

  it('has no row for a currency without spend and null for zero spend', () => {
    expect(roasByCurrency([{ currency: 'USD', amount: '50.00' }], [])).toEqual([]);
    expect(roasByCurrency([{ currency: 'USD', amount: '50.00' }], [{ currency: 'USD', amount: '0.00' }])).toEqual([{ currency: 'USD', value: null }]);
  });
});

describe('moneyList', () => {
  it('sorts by currency for stable responses', () => {
    expect(moneyList(new Map([['USD', '1.00'], ['EUR', '2.00']]))).toEqual([
      { currency: 'EUR', amount: '2.00' },
      { currency: 'USD', amount: '1.00' },
    ]);
    expect(moneyList({ TRY: '5.00' })).toEqual([{ currency: 'TRY', amount: '5.00' }]);
  });
});

describe('summarizeTrialCohort (trial to paid)', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 2, 1) + n * DAY);

  it('counts trials, conversions, the rate and the median seconds to first payment', () => {
    const summary = summarizeTrialCohort([
      { trialStartedAt: day(0), activatedAt: day(10) },
      { trialStartedAt: day(1), activatedAt: day(15) },
      { trialStartedAt: day(2), activatedAt: day(4) },
      { trialStartedAt: day(3), activatedAt: null },
    ]);
    expect(summary.trials).toBe(4);
    expect(summary.converted).toBe(3);
    expect(summary.rate).toBe(0.75);
    // Durations 10, 14 and 2 days: the median is 10 days.
    expect(summary.medianSeconds).toBe(10 * 86_400);
  });

  it('averages the two middle durations for an even count and never goes negative', () => {
    const summary = summarizeTrialCohort([
      { trialStartedAt: day(0), activatedAt: day(2) },
      { trialStartedAt: day(0), activatedAt: day(4) },
    ]);
    expect(summary.medianSeconds).toBe(3 * 86_400);
    expect(summarizeTrialCohort([{ trialStartedAt: day(5), activatedAt: day(4) }]).medianSeconds).toBe(0);
  });

  it('has no rate and no median for an empty cohort or one nobody paid from', () => {
    expect(summarizeTrialCohort([])).toEqual({ trials: 0, converted: 0, rate: null, medianSeconds: null });
    expect(summarizeTrialCohort([{ trialStartedAt: day(0), activatedAt: null }])).toEqual({ trials: 1, converted: 0, rate: 0, medianSeconds: null });
  });
});

describe('compareByCurrency and deltas', () => {
  it('compares per currency; a currency on one side only has no change ratio', () => {
    const result = compareByCurrency(
      [
        { currency: 'USD', value: 120 },
        { currency: 'EUR', value: 80 },
      ],
      [
        { currency: 'USD', value: 100 },
        { currency: 'TRY', value: 50 },
      ],
    );
    expect(result).toEqual([
      { currency: 'EUR', current: 80, previous: null, changeRatio: null, direction: 'neutral' },
      { currency: 'TRY', current: null, previous: 50, changeRatio: null, direction: 'neutral' },
      { currency: 'USD', current: 120, previous: 100, changeRatio: 0.2, direction: 'up' },
    ]);
  });

  it('treats a previous value of 0 as neutral without a percentage', () => {
    expect(compareByCurrency([{ currency: 'USD', value: 10 }], [{ currency: 'USD', value: 0 }])).toEqual([
      { currency: 'USD', current: 10, previous: 0, changeRatio: null, direction: 'neutral' },
    ]);
  });

  const block = (over: Partial<DashboardBlock['acquisition']>, steps: Array<[string, number, number | null]>, trial: DashboardBlock['trial']): DashboardBlock => ({
    from: '2026-03-01T00:00:00.000Z',
    to: '2026-03-31T23:59:59.999Z',
    funnel: {
      id: 'ready.platform_b2b',
      windowDays: null,
      steps: steps.map(([key, reached, rateFromFirst]) => ({ key, reached, rateFromPrevious: null, rateFromFirst, medianSecondsFromPrevious: null })),
    },
    acquisition: { leads: 0, studioPaid: 0, spend: [], revenue: [], cac: [], cpl: [], roas: [], ...over },
    trial,
    channels: { bySource: [], byCampaign: [] },
  });

  it('builds deltas for the funnel, counts, money per currency and the trial rate', () => {
    const current = block(
      { leads: 30, studioPaid: 6, spend: [{ currency: 'USD', amount: '600.00' }], cac: [{ currency: 'USD', amount: '100.00' }], roas: [{ currency: 'USD', value: 2 }] },
      [['lead', 30, 1], ['studio_paid', 6, 0.2]],
      { trials: 10, converted: 6, rate: 0.6, medianSeconds: 86_400 },
    );
    const previous = block(
      { leads: 20, studioPaid: 0, spend: [{ currency: 'USD', amount: '400.00' }], cac: [], roas: [{ currency: 'USD', value: 0 }] },
      [['lead', 20, 1], ['studio_paid', 0, 0]],
      { trials: 8, converted: 4, rate: 0.5, medianSeconds: null },
    );
    const deltas = buildDashboardDeltas(current, previous);
    expect(deltas.leads).toMatchObject({ current: 30, previous: 20, changeRatio: 0.5, direction: 'up' });
    // Previous 0 paid studios: neutral, no percentage.
    expect(deltas.studioPaid).toMatchObject({ current: 6, previous: 0, changeRatio: null, direction: 'neutral' });
    expect(deltas.spend).toEqual([{ currency: 'USD', current: 600, previous: 400, changeRatio: 0.5, direction: 'up' }]);
    expect(deltas.cac).toEqual([{ currency: 'USD', current: 100, previous: null, changeRatio: null, direction: 'neutral' }]);
    expect(deltas.funnel.map((s) => s.key)).toEqual(['lead', 'studio_paid']);
    expect(deltas.funnel[1].rateFromFirstDelta).toBeCloseTo(0.2, 10);
    expect(deltas.trialRateDelta).toBeCloseTo(0.1, 10);
    expect(deltas.trials).toMatchObject({ current: 10, previous: 8 });
  });

  it('moneyToRatios keeps currencies apart', () => {
    expect(moneyToRatios([{ currency: 'EUR', amount: '1.50' }, { currency: 'USD', amount: '2.00' }])).toEqual([
      { currency: 'EUR', value: 1.5 },
      { currency: 'USD', value: 2 },
    ]);
  });
});

describe('channel health math', () => {
  it('warns strictly above 2 percent bounce and 0.08 percent complaints', () => {
    const atLimit = emailHealthOf(7, 10_000, 200, 8);
    expect(atLimit.bounceRate).toBe(0.02);
    expect(atLimit.complaintRate).toBe(0.0008);
    expect(atLimit.bounceWarning).toBe(false);
    expect(atLimit.complaintWarning).toBe(false);
    const above = emailHealthOf(7, 10_000, 201, 9);
    expect(above.bounceWarning).toBe(true);
    expect(above.complaintWarning).toBe(true);
  });

  it('has no rate and no warning without sends', () => {
    expect(emailHealthOf(30, 0, 0, 0)).toMatchObject({ bounceRate: null, complaintRate: null, bounceWarning: false, complaintWarning: false });
    expect(smsHealthOf(7, 0, 0).deliveryRate).toBeNull();
    expect(smsHealthOf(7, 8, 6).deliveryRate).toBe(0.75);
  });

  it('classifies the AI budget', () => {
    // 5000 cents = 50 USD = 50,000,000 micro-USD.
    expect(aiBudgetOf(5000, 10_000_000)).toMatchObject({ level: 'ok', usedRatio: 0.2 });
    expect(aiBudgetOf(5000, 50_000_000 * AI_BUDGET_WARNING_RATIO)).toMatchObject({ level: 'warning' });
    expect(aiBudgetOf(5000, 50_000_000)).toMatchObject({ level: 'exceeded', usedRatio: 1 });
    expect(aiBudgetOf(0, 0)).toEqual({ budgetCents: 0, usedMicroUsd: 0, usedRatio: null, level: 'exceeded' });
  });
});

describe('sanitizeConnectionError', () => {
  it('masks contact details and token-like values and keeps the useful text', () => {
    const text = sanitizeConnectionError('OAuth token expired for ops@example.com; access_token=EAAB1234567890abcdefXYZ and Bearer abcdef123456');
    expect(text).toContain('OAuth token expired');
    expect(text).not.toContain('ops@example.com');
    expect(text).not.toContain('EAAB1234567890abcdefXYZ');
    // No fragment of the token may survive (the phone masking must not cut it in the middle).
    expect(text).not.toContain('abcdefXYZ');
    expect(text).toContain('access_token=[hidden]');
    expect(text).not.toContain('abcdef123456');
  });

  it('cuts long text', () => {
    const cut = sanitizeConnectionError('x '.repeat(500));
    expect(cut.length).toBeLessThanOrEqual(DASHBOARD_ERROR_TEXT_MAX);
  });
});

describe('dashboard query', () => {
  it('accepts no range, or a full range with compare=previous', () => {
    expect(DashboardQuerySchema.safeParse({}).success).toBe(true);
    expect(DashboardQuerySchema.safeParse({ from: '2026-03-01T00:00:00.000Z', to: '2026-03-31T23:59:59.999Z', compare: 'previous' }).success).toBe(true);
  });

  it('rejects a half range, an inverted range, a range over 366 days and an unknown compare', () => {
    expect(DashboardQuerySchema.safeParse({ from: '2026-03-01T00:00:00.000Z' }).success).toBe(false);
    expect(DashboardQuerySchema.safeParse({ from: '2026-03-31T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' }).success).toBe(false);
    expect(DashboardQuerySchema.safeParse({ from: '2025-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' }).success).toBe(false);
    expect(DashboardQuerySchema.safeParse({ compare: 'year' }).success).toBe(false);
    expect(DashboardQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('defaults to the last 30 days ending now', () => {
    const now = new Date('2026-09-29T10:00:00.000Z');
    const range = resolveDashboardRange({}, now);
    expect(range.to).toEqual(now);
    expect(range.to.getTime() - range.from.getTime()).toBe(30 * DAY);
    expect(resolveDashboardRange({ from: '2026-03-01T00:00:00.000Z', to: '2026-03-08T00:00:00.000Z' }, now).from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});
