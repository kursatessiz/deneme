import { BASE_MESSAGES } from '../i18n/messages';
import { createTranslator } from '../i18n/translator';
import type { DashboardBlock } from './dashboard';
import {
  GenerateInsightSchema,
  InsightKpisSchema,
  buildInsightKpis,
  formatInsightChange,
  insightHasSignal,
  insightMetricBase,
  insightMetricKeys,
  insightMetricLine,
} from './insights';

function block(overrides: {
  reached?: number[];
  leads: number;
  studioPaid: number;
  spend?: { amount: string; currency: string }[];
  revenue?: { amount: string; currency: string }[];
  cac?: { amount: string; currency: string }[];
  cpl?: { amount: string; currency: string }[];
  roas?: { currency: string; value: number | null }[];
  trials?: number;
  converted?: number;
}): DashboardBlock {
  const reached = overrides.reached ?? [100, overrides.leads, overrides.studioPaid];
  const keys = ['visit', 'lead', 'studio_paid'];
  return {
    from: '2026-10-05T00:00:00.000Z',
    to: '2026-10-11T23:59:59.999Z',
    funnel: {
      id: 'ready.platform_b2b',
      windowDays: 30,
      steps: keys.map((key, i) => ({ key, reached: reached[i] ?? 0, rateFromPrevious: null, rateFromFirst: null, medianSecondsFromPrevious: null })),
    },
    acquisition: {
      leads: overrides.leads,
      studioPaid: overrides.studioPaid,
      spend: overrides.spend ?? [],
      revenue: overrides.revenue ?? [],
      cac: overrides.cac ?? [],
      cpl: overrides.cpl ?? [],
      roas: overrides.roas ?? [],
    },
    trial: { trials: overrides.trials ?? 0, converted: overrides.converted ?? 0, rate: overrides.trials ? (overrides.converted ?? 0) / overrides.trials : null, medianSeconds: null },
    channels: { bySource: [], byCampaign: [] },
  } as DashboardBlock;
}

const period = { from: '2026-10-05', to: '2026-10-11' };
const previousPeriod = { from: '2026-09-28', to: '2026-10-04' };
const metricOf = (kpis: ReturnType<typeof buildInsightKpis>, key: string) => kpis.metrics.find((m) => m.key === key);

describe('buildInsightKpis', () => {
  const current = block({
    leads: 40,
    studioPaid: 8,
    spend: [
      { amount: '800.00', currency: 'USD' },
      { amount: '300.00', currency: 'EUR' },
    ],
    revenue: [{ amount: '1600.00', currency: 'USD' }],
    cac: [{ amount: '100.00', currency: 'USD' }],
    cpl: [{ amount: '20.00', currency: 'USD' }],
    roas: [{ currency: 'USD', value: 2 }],
    trials: 20,
    converted: 8,
  });
  const previous = block({
    leads: 20,
    studioPaid: 6,
    spend: [{ amount: '400.00', currency: 'USD' }],
    revenue: [{ amount: '400.00', currency: 'USD' }],
    cac: [{ amount: '100.00', currency: 'USD' }],
    cpl: [{ amount: '20.00', currency: 'USD' }],
    roas: [{ currency: 'USD', value: 1 }],
    trials: 10,
    converted: 4,
  });

  it('builds the KPI set, per currency, never summing currencies', () => {
    const kpis = buildInsightKpis(current, previous, period, previousPeriod);
    expect(InsightKpisSchema.safeParse(kpis).success).toBe(true);
    expect(metricOf(kpis, 'leads')).toMatchObject({ current: 40, previous: 20, changeRatio: 1 });
    expect(metricOf(kpis, 'spend:USD')).toMatchObject({ unit: 'money', currency: 'USD', current: 800, previous: 400, changeRatio: 1 });
    expect(metricOf(kpis, 'spend:EUR')).toMatchObject({ current: 300, previous: null, changeRatio: null });
    expect(metricOf(kpis, 'trialRate')).toMatchObject({ unit: 'percent', current: 0.4, previous: 0.4 });
    expect(metricOf(kpis, 'roas:USD')).toMatchObject({ unit: 'ratio', current: 2, previous: 1 });
    expect(kpis.metrics.filter((m) => m.key.startsWith('spend')).map((m) => m.currency)).toEqual(['EUR', 'USD']);
    expect(insightMetricKeys(kpis)).toContain('funnel.studio_paid');
  });

  it('hides counts of people below the minimum and every figure that would reveal them', () => {
    const small = block({
      leads: 3,
      studioPaid: 2,
      spend: [{ amount: '500.00', currency: 'USD' }],
      revenue: [{ amount: '300.00', currency: 'USD' }],
      cac: [{ amount: '250.00', currency: 'USD' }],
      cpl: [{ amount: '166.67', currency: 'USD' }],
      roas: [{ currency: 'USD', value: 0.6 }],
      trials: 4,
      converted: 1,
    });
    const kpis = buildInsightKpis(small, previous, period, previousPeriod);
    expect(metricOf(kpis, 'leads')).toMatchObject({ current: null, previous: 20, changeRatio: null });
    expect(metricOf(kpis, 'studioPaid')?.current).toBeNull();
    expect(metricOf(kpis, 'trials')?.current).toBeNull();
    expect(metricOf(kpis, 'trialRate')?.current).toBeNull();
    // Spend is not person data and stays; revenue, cost and return follow the hidden counts.
    expect(metricOf(kpis, 'spend:USD')?.current).toBe(500);
    expect(metricOf(kpis, 'revenue:USD')).toMatchObject({ current: null, previous: 400 });
    expect(metricOf(kpis, 'cac:USD')?.current).toBeNull();
    expect(metricOf(kpis, 'cpl:USD')?.current).toBeNull();
    expect(metricOf(kpis, 'roas:USD')?.current).toBeNull();
  });

  it('reports no signal for a week with nothing visible', () => {
    const empty = block({ leads: 0, studioPaid: 0, reached: [0, 0, 0] });
    const kpis = buildInsightKpis(empty, empty, period, previousPeriod);
    expect(insightHasSignal(kpis)).toBe(false);
    expect(insightHasSignal(buildInsightKpis(current, previous, period, previousPeriod))).toBe(true);
  });

  it('never carries anything but numbers and keys (no person data)', () => {
    const json = JSON.stringify(buildInsightKpis(current, previous, period, previousPeriod));
    expect(json).not.toMatch(/@|\+\d{6,}/);
  });
});

describe('insight formatting', () => {
  const kpis = buildInsightKpis(
    block({ leads: 40, studioPaid: 8, spend: [{ amount: '800.00', currency: 'USD' }] }),
    block({ leads: 20, studioPaid: 4, spend: [{ amount: '400.00', currency: 'USD' }] }),
    period,
    previousPeriod,
  );
  const tr = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });

  it('formats numbers, money with its own currency and the change per locale', () => {
    const leads = metricOf(kpis, 'leads')!;
    const spend = metricOf(kpis, 'spend:USD')!;
    expect(insightMetricBase('spend:USD')).toBe('spend');
    expect(insightMetricLine(leads, tr, 'en', kpis.minCell)).toBe('Aday: 40 (+100%)');
    expect(insightMetricLine(spend, tr, 'en', kpis.minCell)).toBe('Reklam harcaması (USD): $800.00 (+100%)');
    expect(insightMetricLine(spend, tr, 'de', kpis.minCell)).toContain('800,00');
    expect(formatInsightChange(null, 'en')).toBeNull();
    expect(formatInsightChange(-0.125, 'en')).toBe('-12.5%');
  });

  it('shows a hidden value as text and skips a metric with nothing at all', () => {
    const hiddenNow = { ...metricOf(kpis, 'leads')!, current: null, changeRatio: null };
    expect(insightMetricLine(hiddenNow, tr, 'en', 5)).toContain('5');
    expect(insightMetricLine({ ...hiddenNow, previous: null }, tr, 'en', 5)).toBeNull();
  });
});

describe('GenerateInsightSchema', () => {
  it('defaults to no force and no e-mail', () => {
    expect(GenerateInsightSchema.parse({})).toEqual({ force: false, notify: false });
    expect(GenerateInsightSchema.safeParse({ force: true, notify: true, at: '2026-10-12T00:00:00.000Z' }).success).toBe(true);
    expect(GenerateInsightSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});
