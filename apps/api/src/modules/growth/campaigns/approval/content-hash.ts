import { createHash } from 'crypto';

/** One active template row (tenant override or global default) that a campaign may render. */
export interface TemplateFingerprintRow {
  channel: string;
  locale: string;
  /** 'TENANT' | 'GLOBAL' */
  source: string;
  body: string;
  subject: string | null;
  blocks: unknown;
  whatsappTemplateName: string | null;
  whatsappStatus: string | null;
  isTransactional: boolean;
}

/**
 * What an approval is bound to (docs/PAZARLAMA_MODULU.md 6.1): the template
 * versions the send can use, the segment and its snapshot count, the
 * schedule and the channel. Anything else (the campaign name, the note)
 * may change without invalidating the approval.
 */
export interface CampaignContentInput {
  /** The campaign's own channel, or null for the tenant's channel order. */
  channel: string | null;
  /** The channels the send may use (the channel, or the tenant's order). */
  channels: readonly string[];
  templateKey: string;
  templates: readonly TemplateFingerprintRow[];
  segmentId: string;
  audienceCount: number;
  /** ISO time asked for, or null for "as soon as approved". */
  schedule: string | null;
  /** M3c: the A/B setup (test share, metric, wait); omitted or null without a test. */
  abTest?: { testShare: number; metric: string; waitMinutes: number } | null;
  /**
   * M3c: what each variant sends (its template key, text overrides and the
   * template rows it resolves to). The winner and the stats are chosen while
   * the send runs and are deliberately not part of the content.
   */
  variants?: readonly CampaignVariantFingerprint[];
  /** M3c: when each recipient is scheduled; omitted or FIXED leaves the hash unchanged. */
  sendTime?: { mode: string; local: string | null } | null;
}

export interface CampaignVariantFingerprint {
  key: string;
  templateKey: string | null;
  overrides: { subject?: string; preheader?: string; body?: string } | null;
  /** Rows of this variant's own template (empty when it uses the campaign's). */
  templates: readonly TemplateFingerprintRow[];
}

/** JSON with object keys sorted at every level, so equal content always serialises the same way. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function rowKey(r: TemplateFingerprintRow): string {
  return `${r.channel}|${r.locale}|${r.source}`;
}

/** sha256 hex of the canonical fingerprint; independent of row order and object key order. */
function normaliseRows(rows: readonly TemplateFingerprintRow[]) {
  return [...rows]
    .sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0))
    .map((r) => ({
      channel: r.channel,
      locale: r.locale,
      source: r.source,
      body: r.body,
      subject: r.subject,
      blocks: r.blocks ?? null,
      whatsappTemplateName: r.whatsappTemplateName,
      whatsappStatus: r.whatsappStatus,
      isTransactional: r.isTransactional,
    }));
}

export function campaignContentHash(input: CampaignContentInput): string {
  const templates = normaliseRows(input.templates);
  // The M3c parts only enter the fingerprint when set, so a campaign without a test or a send time mode keeps the hash (and the approval) it had before.
  const abTest = input.abTest ?? null;
  const variants = abTest
    ? [...(input.variants ?? [])]
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((v) => ({ key: v.key, templateKey: v.templateKey, overrides: v.overrides ?? null, templates: normaliseRows(v.templates) }))
    : null;
  const sendTime = input.sendTime && input.sendTime.mode !== 'FIXED' ? { mode: input.sendTime.mode, local: input.sendTime.local } : null;
  const fingerprint = {
    v: 1,
    channel: input.channel,
    channels: [...input.channels],
    templateKey: input.templateKey,
    templates,
    segmentId: input.segmentId,
    audienceCount: input.audienceCount,
    schedule: input.schedule,
    ...(abTest ? { abTest: { testShare: abTest.testShare, metric: abTest.metric, waitMinutes: abTest.waitMinutes }, variants } : {}),
    ...(sendTime ? { sendTime } : {}),
  };
  return createHash('sha256').update(canonicalJson(fingerprint)).digest('hex');
}
