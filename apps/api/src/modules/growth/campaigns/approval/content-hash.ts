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
export function campaignContentHash(input: CampaignContentInput): string {
  const templates = [...input.templates]
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
  const fingerprint = {
    v: 1,
    channel: input.channel,
    channels: [...input.channels],
    templateKey: input.templateKey,
    templates,
    segmentId: input.segmentId,
    audienceCount: input.audienceCount,
    schedule: input.schedule,
  };
  return createHash('sha256').update(canonicalJson(fingerprint)).digest('hex');
}
