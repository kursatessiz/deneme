import {
  CampaignAbTestSchema,
  CampaignVariantInputSchema,
  CampaignVariantsSchema,
  abTestSize,
  assignVariants,
  metricCount,
  pickWinnerKey,
  stableHash,
  variantRate,
} from './campaign-ab';
import type { VariantStatsRow } from './campaign-ab';
import { CreateCampaignSchema, UpdateCampaignSchema } from './campaigns';
import { abSetupToCampaignAbTest } from '../marketing/drafts';

const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

describe('stableHash', () => {
  it('is deterministic and depends on both the input and the seed', () => {
    expect(stableHash('a:b')).toBe(stableHash('a:b'));
    expect(stableHash('a:b')).not.toBe(stableHash('a:c'));
    expect(stableHash('a:b', 1)).not.toBe(stableHash('a:b', 2));
  });
});

describe('abTestSize', () => {
  it('takes the share of the audience but at least one recipient per variant', () => {
    expect(abTestSize(100, 20, 2)).toBe(20);
    expect(abTestSize(100, 20, 3)).toBe(20);
    expect(abTestSize(10, 5, 3)).toBe(3);
    expect(abTestSize(2, 50, 3)).toBe(2);
    expect(abTestSize(0, 20, 2)).toBe(0);
  });
});

describe('assignVariants', () => {
  const keys = ['A', 'B', 'C'];

  it('assigns every recipient exactly once and splits the test evenly', () => {
    const contacts = ids(200);
    const result = assignVariants({ campaignId: CAMPAIGN, contactIds: contacts, variantKeys: keys, testSharePercent: 30 });
    expect([...result.keys()].sort()).toEqual([...contacts].sort());
    const counts = new Map<string | null, number>();
    for (const v of result.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
    expect((counts.get('A') ?? 0) + (counts.get('B') ?? 0) + (counts.get('C') ?? 0)).toBe(60);
    expect(counts.get(null)).toBe(140);
    for (const k of keys) expect(counts.get(k)).toBe(20);
  });

  it('is deterministic: a re-run and any input order give the same variant per recipient', () => {
    const contacts = ids(50);
    const first = assignVariants({ campaignId: CAMPAIGN, contactIds: contacts, variantKeys: keys, testSharePercent: 40 });
    const second = assignVariants({ campaignId: CAMPAIGN, contactIds: [...contacts].reverse(), variantKeys: keys, testSharePercent: 40 });
    for (const id of contacts) expect(second.get(id)).toBe(first.get(id));
  });

  it('differs between campaigns (the hash covers the campaign id)', () => {
    const contacts = ids(60);
    const a = assignVariants({ campaignId: CAMPAIGN, contactIds: contacts, variantKeys: keys, testSharePercent: 50 });
    const b = assignVariants({ campaignId: '22222222-2222-4222-8222-222222222222', contactIds: contacts, variantKeys: keys, testSharePercent: 50 });
    expect(contacts.some((id) => a.get(id) !== b.get(id))).toBe(true);
  });

  it('never assigns a duplicate contact twice and has no test without variants', () => {
    const dup = assignVariants({ campaignId: CAMPAIGN, contactIds: ['x', 'x', 'y'], variantKeys: ['A', 'B'], testSharePercent: 50 });
    expect(dup.size).toBe(2);
    const none = assignVariants({ campaignId: CAMPAIGN, contactIds: ids(5), variantKeys: [], testSharePercent: 50 });
    expect([...none.values()].every((v) => v === null)).toBe(true);
  });

  it('puts a tiny audience fully into the test rather than starving a variant', () => {
    const result = assignVariants({ campaignId: CAMPAIGN, contactIds: ids(3), variantKeys: keys, testSharePercent: 5 });
    expect([...result.values()].sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('pickWinnerKey', () => {
  const rows = (...r: Array<[string, number, number, number, number]>): VariantStatsRow[] =>
    r.map(([key, sent, opened, clicked, converted]) => ({ key, sent, opened, clicked, converted }));

  it('picks the highest rate of the metric, compared as exact fractions', () => {
    const r = rows(['A', 100, 30, 5, 1], ['B', 50, 20, 4, 0], ['C', 100, 10, 9, 2]);
    expect(pickWinnerKey(r, 'OPEN_RATE')).toBe('B');
    expect(pickWinnerKey(r, 'CLICK_RATE')).toBe('C');
    expect(pickWinnerKey(r, 'CONVERSION')).toBe('C');
  });

  it('a tie goes to the first variant, whatever the row order', () => {
    const r = rows(['B', 100, 10, 10, 1], ['A', 50, 5, 5, 1]);
    expect(pickWinnerKey(r, 'OPEN_RATE')).toBe('A');
    expect(pickWinnerKey(rows(['C', 10, 0, 0, 0], ['A', 10, 0, 0, 0], ['B', 10, 0, 0, 0]), 'CLICK_RATE')).toBe('A');
  });

  it('treats a variant nothing was sent to as rate 0 and handles no rows', () => {
    expect(pickWinnerKey(rows(['A', 0, 0, 0, 0], ['B', 10, 1, 0, 0]), 'OPEN_RATE')).toBe('B');
    expect(pickWinnerKey(rows(['A', 10, 1, 0, 0], ['B', 0, 0, 0, 0]), 'OPEN_RATE')).toBe('A');
    expect(pickWinnerKey([], 'OPEN_RATE')).toBeNull();
  });

  it('exposes the metric count and rate', () => {
    const stats = { sent: 20, opened: 5, clicked: 2, converted: 1 };
    expect(metricCount(stats, 'OPEN_RATE')).toBe(5);
    expect(variantRate(stats, 'CLICK_RATE')).toBeCloseTo(0.1);
    expect(variantRate({ sent: 0, opened: 0, clicked: 0, converted: 0 }, 'CONVERSION')).toBe(0);
  });
});

describe('schemas', () => {
  it('validates the A/B setup bounds', () => {
    expect(CampaignAbTestSchema.safeParse({ testShare: 20, metric: 'CLICK_RATE', waitMinutes: 60 }).success).toBe(true);
    expect(CampaignAbTestSchema.safeParse({ testShare: 4, metric: 'CLICK_RATE', waitMinutes: 60 }).success).toBe(false);
    expect(CampaignAbTestSchema.safeParse({ testShare: 20, metric: 'REVENUE', waitMinutes: 60 }).success).toBe(false);
    expect(CampaignAbTestSchema.safeParse({ testShare: 20, metric: 'OPEN_RATE', waitMinutes: 0 }).success).toBe(false);
  });

  it('needs two to five variants with unique keys and only known placeholders in overrides', () => {
    const v = (key: string) => ({ key, overrides: { subject: 'Merhaba {firstName}' } });
    expect(CampaignVariantsSchema.safeParse([v('A'), v('B')]).success).toBe(true);
    expect(CampaignVariantsSchema.safeParse([v('A')]).success).toBe(false);
    expect(CampaignVariantsSchema.safeParse([v('A'), v('A')]).success).toBe(false);
    expect(CampaignVariantInputSchema.safeParse({ key: 'A', overrides: { subject: 'Hi {secret}' } }).success).toBe(false);
    expect(CampaignVariantInputSchema.safeParse({ key: 'F' }).success).toBe(false);
  });

  it('extends the campaign create and update schemas', () => {
    const base = { name: 'x', segmentId: CAMPAIGN, templateKey: 'PROMO' };
    expect(CreateCampaignSchema.safeParse({ ...base, sendTimeMode: 'RECIPIENT_LOCAL', sendTimeLocal: '10:30' }).success).toBe(true);
    expect(CreateCampaignSchema.safeParse({ ...base, sendTimeLocal: '25:00' }).success).toBe(false);
    expect(UpdateCampaignSchema.safeParse({ abTest: null }).success).toBe(true);
  });

  it('turns the AI studio setup into the campaign setup', () => {
    expect(abSetupToCampaignAbTest({ testSharePercent: 25, metric: 'CLICK', waitHours: 12 })).toEqual({ testShare: 25, metric: 'CLICK_RATE', waitMinutes: 720 });
    expect(abSetupToCampaignAbTest({ testSharePercent: 10, metric: 'CONVERSION', waitHours: 1 }).metric).toBe('CONVERSION');
  });
});
