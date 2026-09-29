import { z } from 'zod';
import { messagePlaceholders } from '../messaging-engine';

/**
 * Campaign A/B test (M3c, docs/PAZARLAMA_MODULU.md 4.3 item 2): the test
 * share of the audience is split evenly across the variants, the winner is
 * chosen by a metric after a wait, and the rest of the audience receives the
 * winner. Assignment and winner selection are pure functions here so the API
 * and the tests share one implementation.
 */

export const CAMPAIGN_AB_METRICS = ['OPEN_RATE', 'CLICK_RATE', 'CONVERSION'] as const;
export type CampaignAbMetric = (typeof CAMPAIGN_AB_METRICS)[number];

export const CAMPAIGN_VARIANT_KEYS = ['A', 'B', 'C', 'D', 'E'] as const;
export type CampaignVariantKey = (typeof CAMPAIGN_VARIANT_KEYS)[number];
export const CAMPAIGN_MAX_VARIANTS = CAMPAIGN_VARIANT_KEYS.length;

export const AB_TEST_MIN_SHARE_PERCENT = 5;
export const AB_TEST_MAX_SHARE_PERCENT = 50;
export const AB_TEST_MAX_WAIT_MINUTES = 7 * 24 * 60;

export const CampaignTemplateKeySchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,59}$/, 'Geçersiz şablon anahtarı');

export const CampaignAbTestSchema = z
  .object({
    /** Percent of the audience that receives the test. */
    testShare: z.number().int().min(AB_TEST_MIN_SHARE_PERCENT).max(AB_TEST_MAX_SHARE_PERCENT),
    metric: z.enum(CAMPAIGN_AB_METRICS),
    /** Minutes between the last test message and the winner choice. */
    waitMinutes: z.number().int().min(1).max(AB_TEST_MAX_WAIT_MINUTES),
  })
  .strict();
export type CampaignAbTestInput = z.infer<typeof CampaignAbTestSchema>;

/** Placeholders the campaign send fills; nothing else may appear in braces of an override. */
const OVERRIDE_PLACEHOLDERS = ['firstName', 'studioName'];

const OverrideText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => messagePlaceholders(v).every((p) => OVERRIDE_PLACEHOLDERS.includes(p)), { message: 'Yalnızca {firstName} ve {studioName} değişkenleri kullanılabilir' });

/** E-mail: subject, preheader and body; SMS: body. WhatsApp always uses its approved template and ignores overrides. */
export const CampaignVariantOverridesSchema = z
  .object({
    subject: OverrideText(300).optional(),
    preheader: OverrideText(300).optional(),
    body: OverrideText(10_000).optional(),
  })
  .strict();
export type CampaignVariantOverrides = z.infer<typeof CampaignVariantOverridesSchema>;

export const CampaignVariantInputSchema = z
  .object({
    key: z.enum(CAMPAIGN_VARIANT_KEYS),
    /** Another message template; null or omitted: the campaign's own template. */
    templateKey: CampaignTemplateKeySchema.nullable().optional(),
    overrides: CampaignVariantOverridesSchema.nullable().optional(),
    /** Provenance: the AI studio draft this variant came from. */
    aiDraftId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CampaignVariantInput = z.infer<typeof CampaignVariantInputSchema>;

export const CampaignVariantsSchema = z
  .array(CampaignVariantInputSchema)
  .min(2, 'En az iki varyant gerekir')
  .max(CAMPAIGN_MAX_VARIANTS)
  .refine((v) => new Set(v.map((x) => x.key)).size === v.length, { message: 'Varyant anahtarları benzersiz olmalı' });

export const PickCampaignWinnerSchema = z
  .object({
    /** Omitted: the metric decides. */
    variantKey: z.enum(CAMPAIGN_VARIANT_KEYS).optional(),
  })
  .strict();
export type PickCampaignWinnerInput = z.infer<typeof PickCampaignWinnerSchema>;

/** Counts per variant, from the recipients that were sent that variant. */
export interface VariantStats {
  sent: number;
  opened: number;
  clicked: number;
  converted: number;
}

export interface VariantStatsRow extends VariantStats {
  key: string;
}

export type CampaignAbPhase = 'NOT_STARTED' | 'TEST' | 'WAITING' | 'DECIDED';

export interface CampaignVariantDTO {
  id: string;
  key: string;
  templateKey: string | null;
  overrides: CampaignVariantOverrides | null;
  aiDraftId: string | null;
  isWinner: boolean;
  /** Live while the test runs; the cache written at the decision afterwards. Null before the send starts. */
  stats: VariantStats | null;
}

// ---------------------------------------------------------------------------
// Deterministic assignment
// ---------------------------------------------------------------------------

/** cyrb53: a small, well-mixed non-cryptographic 53-bit string hash (no crypto module: this also runs in the browser). */
export function stableHash(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** How many recipients form the test: the share of the audience, at least one per variant, at most everyone. */
export function abTestSize(audience: number, testSharePercent: number, variantCount: number): number {
  if (audience <= 0) return 0;
  const byShare = Math.round((audience * testSharePercent) / 100);
  return Math.min(audience, Math.max(byShare, variantCount));
}

/**
 * Assigns every recipient exactly once: the recipients are ranked by the hash
 * of campaignId + contactId (ties by contact id), the first `abTestSize` form
 * the test and take the variants in turn (so the split is even to within
 * one), the rest are held back (null) for the winner. No randomness: the same
 * campaign and audience always give the same assignment, in any input order.
 */
export function assignVariants(input: {
  campaignId: string;
  contactIds: readonly string[];
  variantKeys: readonly string[];
  testSharePercent: number;
}): Map<string, string | null> {
  const ids = [...new Set(input.contactIds)];
  const keys = [...input.variantKeys];
  const result = new Map<string, string | null>();
  if (keys.length === 0) {
    for (const id of ids) result.set(id, null);
    return result;
  }
  const ranked = ids
    .map((id) => ({ id, rank: stableHash(`${input.campaignId}:${id}`) }))
    .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const testSize = abTestSize(ranked.length, input.testSharePercent, keys.length);
  ranked.forEach((entry, index) => result.set(entry.id, index < testSize ? keys[index % keys.length] : null));
  return result;
}

// ---------------------------------------------------------------------------
// Winner selection
// ---------------------------------------------------------------------------

/** The numerator of the metric for one variant (its denominator is always the number sent). */
export function metricCount(stats: VariantStats, metric: CampaignAbMetric): number {
  return metric === 'OPEN_RATE' ? stats.opened : metric === 'CLICK_RATE' ? stats.clicked : stats.converted;
}

/** Rate of a variant as an exact fraction (no floating point ties): count / sent, 0 when nothing was sent. */
function fraction(stats: VariantStats, metric: CampaignAbMetric): { num: number; den: number } {
  return { num: metricCount(stats, metric), den: stats.sent };
}

/** Numeric rate for display (0-1). */
export function variantRate(stats: VariantStats, metric: CampaignAbMetric): number {
  return stats.sent > 0 ? metricCount(stats, metric) / stats.sent : 0;
}

/**
 * The winning variant key: the highest rate of the metric (compared exactly,
 * as fractions); a tie goes to the variant that comes first (keys sorted, so
 * A before B). A variant nothing was sent to has rate 0. Null without rows.
 */
export function pickWinnerKey(rows: readonly VariantStatsRow[], metric: CampaignAbMetric): string | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let best = ordered[0];
  for (const row of ordered.slice(1)) {
    const a = fraction(row, metric);
    const b = fraction(best, metric);
    // a/aDen > b/bDen, with a zero denominator meaning rate 0.
    const left = a.den === 0 ? 0 : a.num / a.den;
    const right = b.den === 0 ? 0 : b.num / b.den;
    const strictlyBetter = a.den === 0 || b.den === 0 ? left > right : a.num * b.den > b.num * a.den;
    if (strictlyBetter) best = row;
  }
  return best.key;
}
