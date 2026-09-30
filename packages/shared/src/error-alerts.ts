import { z } from 'zod';
import type { Translate } from './i18n/translator';
import { ERROR_LIMITS, scrubPii, truncate } from './error-reporting';
import type { ErrorSource } from './error-reporting';

/**
 * H3 error reporting completion (docs/HATA_RAPORLAMA.md): spike detection,
 * alert sinks (payload builders and the outbound allow-list), group merging,
 * user feedback and source context. Pure TypeScript shared by the API, the
 * web panel and the mobile app; nothing here touches the network or a
 * database, so every rule is unit tested in error-alerts.spec.ts.
 */

// ---------------------------------------------------------------------------
// Alert kinds and spike detection
// ---------------------------------------------------------------------------

/** Kinds of a stored alert (error_alerts.kind). */
export const ERROR_ALERT_KINDS = ['SPIKE', 'NEW_GROUP', 'REGRESSION'] as const;
export type ErrorAlertRecordKind = (typeof ERROR_ALERT_KINDS)[number];

/** Spike detection counts events per group in UTC-aligned 15-minute buckets. */
export const ERROR_BUCKET_MINUTES = 15;
export const ERROR_BUCKET_MS = ERROR_BUCKET_MINUTES * 60 * 1000;
/** Trailing 24 hours of buckets form the baseline. */
export const ERROR_BASELINE_BUCKETS = 96;
/** Buckets are kept 48 hours (the baseline plus slack); the heartbeat deletes older ones. */
export const ERROR_BUCKET_RETENTION_HOURS = 48;

export function bucketStartOf(at: Date | number): Date {
  const ms = typeof at === 'number' ? at : at.getTime();
  return new Date(Math.floor(ms / ERROR_BUCKET_MS) * ERROR_BUCKET_MS);
}

/** Thresholds of spike detection; stored as data in the error settings, never hard-coded at the call site. */
export const ErrorSpikeSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** A window spikes when it reaches this multiple of the baseline mean per 15 minutes. */
    ratio: z.number().min(1.5).max(100),
    /** Below this many events in the window nothing is ever a spike. */
    minWindowCount: z.number().int().min(1).max(100_000),
    /** Baselines with fewer events in 24 hours are too thin for a ratio; the absolute floor applies instead. */
    minBaselineEvents: z.number().int().min(0).max(1_000_000),
    /** Events in the window that count as a spike for a first-seen group or a thin baseline. */
    absoluteFloor: z.number().int().min(1).max(1_000_000),
  })
  .strict();
export type ErrorSpikeSettings = z.infer<typeof ErrorSpikeSettingsSchema>;

export const ERROR_SPIKE_DEFAULTS: Readonly<ErrorSpikeSettings> = Object.freeze({
  enabled: true,
  ratio: 5,
  minWindowCount: 10,
  minBaselineEvents: 20,
  absoluteFloor: 50,
});

/** Default and bounds of the per-group alert cooldown (minutes). */
export const ERROR_ALERT_COOLDOWN_DEFAULT_MINUTES = 60;
export const ERROR_ALERT_COOLDOWN_MIN_MINUTES = 5;
export const ERROR_ALERT_COOLDOWN_MAX_MINUTES = 1440;

/** Stored partial settings merged over the defaults; an invalid key falls back to its default. */
export function resolveSpikeSettings(raw: unknown): ErrorSpikeSettings {
  const out: ErrorSpikeSettings = { ...ERROR_SPIKE_DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const partial = ErrorSpikeSettingsSchema.partial();
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(ERROR_SPIKE_DEFAULTS) as Array<keyof ErrorSpikeSettings>) {
    if (!(key in record)) continue;
    const parsed = partial.safeParse({ [key]: record[key] });
    if (parsed.success && parsed.data[key] !== undefined) (out as Record<string, unknown>)[key] = parsed.data[key];
  }
  return out;
}

export interface SpikeInput {
  /** Events of the group in the window (one 15-minute bucket). */
  windowCount: number;
  /** Events in the trailing baseline buckets before the window. */
  baselineTotal: number;
  /** How many 15-minute buckets the group existed before the window, 0..96 (see observedBaselineBuckets). */
  observedBuckets: number;
}

export interface SpikeVerdict {
  spike: boolean;
  /** RATIO compares with the baseline mean; ABSOLUTE uses the floor (first-seen group or thin baseline). */
  mode: 'RATIO' | 'ABSOLUTE';
  /** Mean events per 15-minute bucket of the baseline, two decimals. */
  baselineMean: number;
  /** The count the window had to reach. */
  threshold: number;
}

function wholeNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The number of buckets the baseline covers for a group: buckets between the
 * group's first-seen bucket and the window, at most 96. A group first seen
 * inside the window has none, so it can only spike through the absolute floor.
 */
export function observedBaselineBuckets(firstSeenAt: Date, windowStart: Date): number {
  const first = bucketStartOf(firstSeenAt).getTime();
  const observed = Math.floor((windowStart.getTime() - first) / ERROR_BUCKET_MS);
  return Math.min(ERROR_BASELINE_BUCKETS, Math.max(0, observed));
}

/**
 * Decides whether a window is a spike. With no usable baseline (a group first
 * seen in the window, or fewer than minBaselineEvents in the observed
 * baseline) only the absolute floor counts, so a quiet group that gets a
 * handful of events never alerts; otherwise the window must reach
 * ratio x the baseline mean per 15 minutes. minWindowCount always applies.
 */
export function detectSpike(input: SpikeInput, settings: ErrorSpikeSettings): SpikeVerdict {
  const windowCount = wholeNonNegative(input.windowCount);
  const baselineTotal = wholeNonNegative(input.baselineTotal);
  const observed = Math.min(ERROR_BASELINE_BUCKETS, wholeNonNegative(input.observedBuckets));
  const mean = observed > 0 ? Math.round((baselineTotal / observed) * 100) / 100 : 0;
  const absolute = observed === 0 || baselineTotal < settings.minBaselineEvents;
  const threshold = absolute
    ? Math.max(settings.minWindowCount, settings.absoluteFloor)
    : Math.max(settings.minWindowCount, Math.ceil((baselineTotal / observed) * settings.ratio));
  return {
    spike: settings.enabled && windowCount >= threshold,
    mode: absolute ? 'ABSOLUTE' : 'RATIO',
    baselineMean: mean,
    threshold,
  };
}

// ---------------------------------------------------------------------------
// Group merging
// ---------------------------------------------------------------------------

/** Merge chains are short; anything longer (or a cycle) is treated as unresolvable. */
export const ERROR_MERGE_MAX_HOPS = 10;

/**
 * Follows `mergedIntoId` links from a group to the live group that owns it.
 * Returns the id itself when it is not merged, and null on a cycle or a chain
 * longer than ERROR_MERGE_MAX_HOPS.
 */
export function followMergeChain(startId: string, mergedIntoOf: (id: string) => string | null): string | null {
  const seen = new Set<string>([startId]);
  let current = startId;
  for (let hop = 0; hop < ERROR_MERGE_MAX_HOPS; hop++) {
    const next = mergedIntoOf(current);
    if (!next) return current;
    if (seen.has(next)) return null;
    seen.add(next);
    current = next;
  }
  return null;
}

export const ErrorGroupMergeSchema = z.object({ targetId: z.string().uuid() }).strict();
export type ErrorGroupMergeInput = z.infer<typeof ErrorGroupMergeSchema>;

// ---------------------------------------------------------------------------
// Alert sinks
// ---------------------------------------------------------------------------

export const ERROR_ALERT_SINKS = ['WEBHOOK', 'SLACK'] as const;
export type ErrorAlertSink = (typeof ERROR_ALERT_SINKS)[number];
export const ERROR_ALERT_DELIVERY_STATUSES = ['PENDING', 'SUCCEEDED', 'ABANDONED'] as const;
export type ErrorAlertDeliveryStatus = (typeof ERROR_ALERT_DELIVERY_STATUSES)[number];

/**
 * Outbound hosts of the alert sinks that have a fixed provider (rule: outbound
 * HTTP only to allow-listed hosts). The generic signed webhook has no fixed
 * host: it is any public https URL and passes the webhooks module's SSRF
 * guard at save time and again, pinned to the resolved address, at delivery.
 */
export const ERROR_ALERT_SINK_ALLOWED_HOSTS: Readonly<Record<'SLACK', readonly string[]>> = Object.freeze({
  SLACK: ['hooks.slack.com'],
});

/** A Slack incoming webhook URL: https, an allow-listed host, a /services/... path of plain characters, no credentials, port or query. */
export function isSlackWebhookUrl(value: string): boolean {
  if (value.length > 500) return false;
  for (const host of ERROR_ALERT_SINK_ALLOWED_HOSTS.SLACK) {
    const prefix = `https://${host}/services/`;
    if (!value.startsWith(prefix)) continue;
    const rest = value.slice(prefix.length);
    if (rest.length === 0) return false;
    for (const c of rest) {
      const ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '-' || c === '/';
      if (!ok) return false;
    }
    return true;
  }
  return false;
}

/** What every sink receives about an alert: a scrubbed summary, never a stack, message or user data. */
export interface ErrorAlertNotification {
  alertId: string;
  kind: ErrorAlertRecordKind;
  groupId: string;
  /** The group's scrubbed, normalised title. */
  title: string;
  source: ErrorSource;
  release: string | null;
  code: string | null;
  windowCount: number;
  baselineMean: number;
  threshold: number;
  affectedStudioCount: number;
  occurredAt: string;
  /** Admin panel link to the group. */
  link: string;
}

/** The body of the generic signed webhook (docs/HATA_RAPORLAMA.md, "Uyarı hedefleri"). */
export interface ErrorAlertWebhookPayload {
  event: 'error.alert';
  version: 1;
  alert: {
    id: string;
    kind: ErrorAlertRecordKind;
    groupId: string;
    title: string;
    source: ErrorSource;
    release: string | null;
    code: string | null;
    windowCount: number;
    baselineMean: number;
    threshold: number;
    affectedStudioCount: number;
    occurredAt: string;
    link: string;
  };
}

export function buildAlertWebhookPayload(n: ErrorAlertNotification): ErrorAlertWebhookPayload {
  return {
    event: 'error.alert',
    version: 1,
    alert: {
      id: n.alertId,
      kind: n.kind,
      groupId: n.groupId,
      title: truncate(n.title, ERROR_LIMITS.titleLength),
      source: n.source,
      release: n.release,
      code: n.code,
      windowCount: n.windowCount,
      baselineMean: n.baselineMean,
      threshold: n.threshold,
      affectedStudioCount: n.affectedStudioCount,
      occurredAt: n.occurredAt,
      link: n.link,
    },
  };
}

/** Slack mrkdwn treats & < > specially; everything else in a title is shown as text. */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
}
export interface SlackAlertPayload {
  text: string;
  blocks: Array<
    | { type: 'header'; text: SlackTextObject }
    | { type: 'section'; text: SlackTextObject }
    | { type: 'section'; fields: SlackTextObject[] }
    | { type: 'actions'; elements: Array<{ type: 'button'; text: SlackTextObject; url: string }> }
  >;
}

/**
 * The Slack incoming webhook body: a header with the alert kind, the group
 * title, a summary line, a few facts and a button to the admin panel. Texts
 * come from the catalogue (`t`); the title is escaped and truncated.
 */
export function buildSlackAlertPayload(n: ErrorAlertNotification, t: Translate): SlackAlertPayload {
  const title = escapeSlackText(truncate(n.title, 120));
  const heading = t(`adminErrors.alert.kind.${n.kind}`);
  const summary = t(`adminErrors.alert.summary.${n.kind}`, {
    windowCount: n.windowCount,
    baselineMean: n.baselineMean,
    threshold: n.threshold,
    source: t(`errors.source.${n.source}`),
    release: n.release ?? '-',
  });
  const facts: Array<[string, string]> = [
    [t('adminErrors.alert.field.source'), t(`errors.source.${n.source}`)],
    [t('adminErrors.alert.field.release'), n.release ?? '-'],
    [t('adminErrors.alert.field.code'), n.code ?? '-'],
    [t('adminErrors.alert.field.studios'), String(n.affectedStudioCount)],
  ];
  return {
    text: `${heading}: ${title}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: truncate(heading, 150) } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${title}*\n${escapeSlackText(summary)}` } },
      { type: 'section', fields: facts.map(([label, value]) => ({ type: 'mrkdwn' as const, text: `*${escapeSlackText(label)}*\n${escapeSlackText(value)}` })) },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: t('adminErrors.alert.open') }, url: n.link }] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Settings (super admin) and the per-tenant opt-in
// ---------------------------------------------------------------------------

const WebhookUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('https://') && v.length > 'https://'.length && !/\s/.test(v), 'Webhook adresi https:// ile başlamalıdır');

export const ErrorSettingsUpdateSchema = z
  .object({
    spike: ErrorSpikeSettingsSchema.partial().optional(),
    cooldownMinutes: z.number().int().min(ERROR_ALERT_COOLDOWN_MIN_MINUTES).max(ERROR_ALERT_COOLDOWN_MAX_MINUTES).optional(),
    webhook: z
      .object({
        /** null removes the stored URL and secret. */
        url: WebhookUrlSchema.nullable().optional(),
        /** Signing secret; null removes it. Never returned. */
        secret: z.string().min(16).max(200).nullable().optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    slack: z
      .object({
        url: z
          .string()
          .trim()
          .max(500)
          .refine(isSlackWebhookUrl, 'Geçersiz Slack webhook adresi')
          .nullable()
          .optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ErrorSettingsUpdate = z.infer<typeof ErrorSettingsUpdateSchema>;

export interface ErrorSettingsDTO {
  spike: ErrorSpikeSettings;
  cooldownMinutes: number;
  webhook: { configured: boolean; host: string | null; secretLast4: string | null; enabled: boolean };
  slack: { configured: boolean; enabled: boolean };
  /** False when INTEGRATION_ENCRYPTION_KEY is missing in production: sink secrets cannot be stored. */
  encryptionAvailable: boolean;
}

export const StudioErrorSettingsUpdateSchema = z.object({ ownerNotify: z.boolean() }).strict();
export interface StudioErrorSettingsDTO {
  ownerNotify: boolean;
}

export interface ErrorAlertDeliveryDTO {
  sink: ErrorAlertSink;
  status: ErrorAlertDeliveryStatus;
  attempt: number;
}

export interface ErrorAlertDTO {
  id: string;
  groupId: string;
  groupTitle: string;
  kind: ErrorAlertRecordKind;
  windowStart: string;
  windowEnd: string;
  windowCount: number;
  baselineMean: number;
  threshold: number;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  deliveries: ErrorAlertDeliveryDTO[];
}

export const ErrorAlertListQuerySchema = z.object({
  kind: z.enum(ERROR_ALERT_KINDS).optional(),
  acknowledged: z.enum(['true', 'false']).optional(),
  groupId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type ErrorAlertListQuery = z.infer<typeof ErrorAlertListQuerySchema>;

export interface ErrorAlertListDTO {
  items: ErrorAlertDTO[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// User feedback
// ---------------------------------------------------------------------------

export const ERROR_FEEDBACK_MAX_LENGTH = 500;

/** POST /telemetry/errors/:eventId/feedback. No e-mail or contact field exists, by design. */
export const ErrorFeedbackSchema = z.object({
  feedback: z.string().max(ERROR_FEEDBACK_MAX_LENGTH * 2),
  /** Same optional per-session id as the error batch; only feeds the per-session rate limit. */
  sessionId: z.string().min(16).max(64).optional(),
});
export type ErrorFeedbackInput = z.infer<typeof ErrorFeedbackSchema>;

/**
 * The feedback as it is stored: control characters removed (newlines kept),
 * PII masked with the same scrubber as error messages, whitespace trimmed and
 * cut to 500 characters. Empty when nothing is left.
 */
export function scrubFeedback(input: string): string {
  let cleaned = '';
  const limit = Math.min(input.length, ERROR_FEEDBACK_MAX_LENGTH * 4);
  for (let i = 0; i < limit; i++) {
    const code = input.charCodeAt(i);
    cleaned += code < 32 && code !== 10 ? ' ' : input[i];
  }
  return truncate(scrubPii(cleaned, ERROR_FEEDBACK_MAX_LENGTH * 4).trim(), ERROR_FEEDBACK_MAX_LENGTH);
}

// ---------------------------------------------------------------------------
// Source context of resolved frames
// ---------------------------------------------------------------------------

/** Lines of context kept on each side of the original line. */
export const ERROR_CONTEXT_RADIUS = 1;
/** Resolved frames that get context per event (the first ones, where the error was raised). */
export const ERROR_CONTEXT_MAX_FRAMES = 3;
const ERROR_CONTEXT_LINE_LENGTH = 200;
const ERROR_CONTEXT_MAX_SOURCE_LENGTH = 2_000_000;

export interface ErrorSourceContext {
  /** The resolved location, "src/app/page.tsx:12:5". */
  location: string;
  /** 1-based number of the first line in `lines`. */
  startLine: number;
  lines: string[];
  /** Index of the failing line inside `lines`. */
  focus: number;
}

export const ErrorSourceContextSchema = z.object({
  location: z.string().max(400),
  startLine: z.number().int().min(1),
  lines: z.array(z.string().max(ERROR_CONTEXT_LINE_LENGTH)).min(1).max(2 * ERROR_CONTEXT_RADIUS + 1),
  focus: z.number().int().min(0),
});

/**
 * The lines around a 1-based line of an original source file (from a source
 * map's sourcesContent): the line and `radius` lines on each side, each
 * scrubbed and cut to 200 characters. Null for a line outside the file or a
 * source too large to scan.
 */
export function extractSourceContext(
  content: string,
  line: number,
  radius: number = ERROR_CONTEXT_RADIUS,
): { startLine: number; lines: string[]; focus: number } | null {
  if (!Number.isInteger(line) || line < 1 || content.length > ERROR_CONTEXT_MAX_SOURCE_LENGTH) return null;
  const first = Math.max(1, line - radius);
  const last = line + radius;
  const lines: string[] = [];
  let current = 1;
  let start = 0;
  while (current <= last) {
    let end = content.indexOf('\n', start);
    const atEnd = end === -1;
    if (atEnd) end = content.length;
    if (current >= first) {
      let text = content.slice(start, end);
      if (text.endsWith('\r')) text = text.slice(0, -1);
      lines.push(truncate(scrubPii(text.replace(/\t/g, '  '), ERROR_CONTEXT_LINE_LENGTH * 2), ERROR_CONTEXT_LINE_LENGTH));
    }
    if (atEnd) break;
    start = end + 1;
    current++;
  }
  // The failing line must exist: a line past the end of the file is not context.
  if (current < line || lines.length === 0) return null;
  return { startLine: first, lines, focus: line - first };
}

/** Parses the stored JSON column back into a validated list (bad entries are dropped). */
export function parseSourceContexts(raw: unknown): ErrorSourceContext[] {
  if (!Array.isArray(raw)) return [];
  const out: ErrorSourceContext[] = [];
  for (const item of raw.slice(0, ERROR_CONTEXT_MAX_FRAMES)) {
    const parsed = ErrorSourceContextSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
