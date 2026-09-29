import { containsHtml } from '../ai/translation';
import { MARKETING_ALLOWED_PLACEHOLDERS, bracePlaceholders, type MarketingDraftKind } from './drafts';

/**
 * Deterministic brand and tone checks (docs/PAZARLAMA_MODULU.md 4.4). They
 * run whenever a variant is saved or generated and never call a model. A
 * BLOCKING issue keeps a draft from being exported to a campaign; a WARNING
 * is shown next to the text and left to the reviewer. Drafts are always
 * saved, whatever the result.
 */

export type MarketingCheckCode =
  | 'BANNED_PHRASE'
  | 'LENGTH_EXCEEDED'
  | 'COUNT_OUT_OF_RANGE'
  | 'MISSING_DISCLAIMER'
  | 'EMOJI'
  | 'HTML'
  | 'UNKNOWN_PLACEHOLDER'
  | 'SHOUTING'
  | 'EXCLAMATION_OVERUSE'
  | 'SMS_MULTI_SEGMENT'
  | 'PLACEHOLDER_EDGE';

/** What a check run is about: a draft kind, or an organic social post (M4b; not an AI draft kind). */
export type MarketingCheckKind = MarketingDraftKind | 'SOCIAL_POST';

export type MarketingCheckSeverity = 'BLOCKING' | 'WARNING';

export interface MarketingCheckIssue {
  code: MarketingCheckCode;
  severity: MarketingCheckSeverity;
  /** Field path inside the content, e.g. `headlines[2]`. */
  field: string;
  /** Offending phrase, placeholder name or similar. */
  detail?: string;
  limit?: number;
  actual?: number;
}

export interface MarketingCheckContext {
  locale: string;
  /** Banned phrases of the brand kit for this locale. */
  bannedPhrases: readonly string[];
  /** Required text for the kind's channel (email, sms, whatsapp), if the kit sets one. */
  requiredDisclaimer?: string | null;
}

/** Character limit per text field (base name without indices), per kind. Ad limits follow the networks' own limits. */
export const MARKETING_FIELD_LIMITS: Partial<Record<MarketingCheckKind, Readonly<Record<string, number>>>> = {
  EMAIL: { subject: 70, preheader: 100, body: 2_000 },
  SMS: { text: 480 },
  WHATSAPP: { body: 1_024 },
  AD_META: { primaryText: 125, headline: 40, description: 30 },
  AD_GOOGLE_RSA: { headlines: 30, descriptions: 90 },
  AD_LINKEDIN: { introText: 150, headline: 70, description: 100 },
  LANDING_BLOCK: { heading: 80, subheading: 160, bullets: 100, ctaLabel: 30 },
  SUBJECT_LINES: { subject: 70, preheader: 100 },
  CTA_VARIANTS: { label: 30 },
  SEO_OUTLINE: { title: 60, metaDescription: 160, 'headings.text': 100, 'faq.question': 150, 'faq.answer': 500 },
};

/** Allowed item counts of list fields. */
export const MARKETING_COUNT_LIMITS: Partial<Record<MarketingCheckKind, Readonly<Record<string, { min: number; max: number }>>>> = {
  AD_GOOGLE_RSA: { headlines: { min: 3, max: 15 }, descriptions: { min: 2, max: 4 } },
  LANDING_BLOCK: { bullets: { min: 0, max: 6 } },
};

/** Fields whose text is checked; kinds not listed check every string field. */
const CHECKED_FIELDS: Partial<Record<MarketingCheckKind, readonly string[]>> = {
  SOCIAL_POST: ['text'],
  WHATSAPP: ['body'],
  SEGMENT_SUGGESTION: ['name', 'rationale'],
  RESEARCH_NOTE: ['summary', 'points.claim'],
};

/** The field that must carry the channel's required disclaimer. */
const DISCLAIMER_FIELD: Partial<Record<MarketingCheckKind, string>> = { EMAIL: 'body', SMS: 'text', WHATSAPP: 'body' };

export type DisclaimerChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';

/** Channel whose required disclaimer applies to a kind, or null. */
export function disclaimerChannelOf(kind: MarketingCheckKind): DisclaimerChannel | null {
  return kind === 'EMAIL' || kind === 'SMS' || kind === 'WHATSAPP' ? kind : null;
}

interface FieldText {
  field: string;
  base: string;
  text: string;
}

function collect(value: unknown, path: string, out: FieldText[]): void {
  if (typeof value === 'string') {
    out.push({ field: path, base: path.replace(/\[\d+\]/g, ''), text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collect(item, `${path}[${index}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) collect(child, path ? `${path}.${key}` : key, out);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Phrases found in `text`, matched case-insensitively (locale aware) on word boundaries. */
export function findBannedPhrases(text: string, phrases: readonly string[], locale: string): string[] {
  let haystack: string;
  try {
    haystack = text.toLocaleLowerCase(locale);
  } catch {
    haystack = text.toLowerCase();
  }
  const found: string[] = [];
  for (const phrase of phrases) {
    const trimmed = phrase.trim();
    if (trimmed === '') continue;
    let needle: string;
    try {
      needle = trimmed.toLocaleLowerCase(locale);
    } catch {
      needle = trimmed.toLowerCase();
    }
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u');
    if (re.test(haystack)) found.push(trimmed);
  }
  return found;
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;

function normalizeForContains(value: string, locale: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  try {
    return collapsed.toLocaleLowerCase(locale);
  } catch {
    return collapsed.toLowerCase();
  }
}

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

export interface SmsSegmentInfo {
  encoding: 'GSM7' | 'UCS2';
  /** Length in encoding units (extension characters count twice in GSM-7). */
  length: number;
  segments: number;
}

/** GSM-7 or UCS-2 encoding, unit length and segment count of an SMS text (160/153 and 70/67 units). */
export function smsSegmentInfo(text: string): SmsSegmentInfo {
  let gsm = true;
  let units = 0;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) units += 1;
    else if (GSM7_EXTENDED.includes(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) return { encoding: 'GSM7', length: units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153) };
  const length = [...text].reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0);
  return { encoding: 'UCS2', length, segments: length === 0 ? 0 : length <= 70 ? 1 : Math.ceil(length / 67) };
}

/**
 * Runs every deterministic check on one variant. Pure: the same input always
 * gives the same issues, in field order.
 */
export function runMarketingChecks(kind: MarketingCheckKind, content: unknown, ctx: MarketingCheckContext): MarketingCheckIssue[] {
  const issues: MarketingCheckIssue[] = [];
  const all: FieldText[] = [];
  collect(content, '', all);
  const allowedFields = CHECKED_FIELDS[kind];
  const fields = allowedFields ? all.filter((f) => allowedFields.includes(f.base)) : all.filter((f) => !['templateName', 'category'].includes(f.base));
  const limits = MARKETING_FIELD_LIMITS[kind] ?? {};
  const allowedPlaceholders: readonly string[] = MARKETING_ALLOWED_PLACEHOLDERS;

  for (const { field, base, text } of fields) {
    for (const phrase of findBannedPhrases(text, ctx.bannedPhrases, ctx.locale)) {
      issues.push({ code: 'BANNED_PHRASE', severity: 'BLOCKING', field, detail: phrase });
    }
    const limit = limits[base];
    if (limit !== undefined && [...text].length > limit) {
      issues.push({ code: 'LENGTH_EXCEEDED', severity: 'BLOCKING', field, limit, actual: [...text].length });
    }
    if (EMOJI_RE.test(text)) issues.push({ code: 'EMOJI', severity: 'BLOCKING', field });
    if (containsHtml(text)) issues.push({ code: 'HTML', severity: 'BLOCKING', field });
    for (const name of bracePlaceholders(text)) {
      if (!allowedPlaceholders.includes(name)) issues.push({ code: 'UNKNOWN_PLACEHOLDER', severity: 'BLOCKING', field, detail: name });
    }
    const shouted = text.match(/(?<![\p{L}\p{N}])\p{Lu}{4,}(?![\p{L}\p{N}])/gu) ?? [];
    if (shouted.length >= 3) issues.push({ code: 'SHOUTING', severity: 'WARNING', field, actual: shouted.length });
    const exclamations = (text.match(/!/g) ?? []).length;
    if (exclamations > 2) issues.push({ code: 'EXCLAMATION_OVERUSE', severity: 'WARNING', field, limit: 2, actual: exclamations });
  }

  const counts = MARKETING_COUNT_LIMITS[kind] ?? {};
  const record = content && typeof content === 'object' ? (content as Record<string, unknown>) : {};
  for (const [field, range] of Object.entries(counts)) {
    const value = record[field];
    const actual = Array.isArray(value) ? value.length : 0;
    if (actual < range.min || actual > range.max) {
      issues.push({ code: 'COUNT_OUT_OF_RANGE', severity: 'BLOCKING', field, limit: actual < range.min ? range.min : range.max, actual });
    }
  }

  const disclaimerField = DISCLAIMER_FIELD[kind];
  if (disclaimerField && ctx.requiredDisclaimer && ctx.requiredDisclaimer.trim() !== '') {
    const body = typeof record[disclaimerField] === 'string' ? (record[disclaimerField] as string) : '';
    if (!normalizeForContains(body, ctx.locale).includes(normalizeForContains(ctx.requiredDisclaimer, ctx.locale))) {
      issues.push({ code: 'MISSING_DISCLAIMER', severity: 'BLOCKING', field: disclaimerField });
    }
  }

  if (kind === 'SMS' && typeof record.text === 'string') {
    const info = smsSegmentInfo(record.text);
    if (info.segments > 1) issues.push({ code: 'SMS_MULTI_SEGMENT', severity: 'WARNING', field: 'text', limit: 1, actual: info.segments, detail: info.encoding });
  }
  if (kind === 'WHATSAPP' && typeof record.body === 'string') {
    const body = record.body.trim();
    if (/^\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(body) || /\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(body)) {
      issues.push({ code: 'PLACEHOLDER_EDGE', severity: 'WARNING', field: 'body' });
    }
  }
  return issues;
}

/** True when at least one issue blocks a campaign export. */
export function hasBlockingIssues(issues: readonly MarketingCheckIssue[]): boolean {
  return issues.some((i) => i.severity === 'BLOCKING');
}
