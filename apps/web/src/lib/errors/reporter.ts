import {
  ERROR_FEEDBACK_MAX_LENGTH,
  ERROR_LIMITS,
  ErrorDedupeWindow,
  errorCodeFromId,
  errorFingerprint,
  normalizeRoute,
  scrubPii,
  scrubRecord,
  truncate,
} from '@platform/shared';
import type { Breadcrumb, BreadcrumbType, ClientErrorEvent, ErrorSeverity } from '@platform/shared';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@/lib/bff/csrf';
import { isProtectedPath } from '@/lib/security/protected-paths';

/**
 * Browser-side error reporter (docs/HATA_RAPORLAMA.md): a breadcrumb ring
 * buffer, and reportError() that scrubs, dedupes and batches events to the
 * API. Pages behind a session report through the BFF
 * (/api/bff/telemetry/errors, so the user and studio come from the
 * session); public pages use the dedicated minimal route
 * /api/telemetry/errors. Both are same-origin fetches, allowed by the
 * `connect-src 'self'` of every CSP. Reporting never throws and never
 * reports its own failures.
 */

const SESSION_KEY = 'pw_err_sid';
/** Events one page load may send at most; a render loop must not flood the API. */
const MAX_EVENTS_PER_PAGE = 30;
const FLUSH_DELAY_MS = 1000;

let release = 'dev';
let environment = 'production';
const crumbs: Breadcrumb[] = [];
const pending: ClientErrorEvent[] = [];
const dedupe = new ErrorDedupeWindow(1000);
let sent = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** error object -> code, so a boundary re-rendering (or StrictMode) shows the same code. */
const codes = new WeakMap<object, string>();
/** error object -> event id, for the optional feedback note (H3). */
const eventIds = new WeakMap<object, string>();

export function configureErrorReporter(options: { release: string; environment: string }): void {
  release = options.release;
  environment = options.environment;
}

export function addBreadcrumb(type: BreadcrumbType, message: string, data?: Record<string, string>): void {
  try {
    crumbs.push({
      type,
      message: scrubPii(truncate(message, ERROR_LIMITS.breadcrumbMessageLength * 2), ERROR_LIMITS.breadcrumbMessageLength).slice(0, ERROR_LIMITS.breadcrumbMessageLength),
      at: new Date().toISOString(),
      ...(data ? { data: scrubRecord(data, ERROR_LIMITS.breadcrumbDataValueLength) } : {}),
    });
    if (crumbs.length > ERROR_LIMITS.breadcrumbs) crumbs.splice(0, crumbs.length - ERROR_LIMITS.breadcrumbs);
  } catch {
    // Breadcrumbs are best effort.
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Old browsers: RFC 4122 v4 from getRandomValues.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sessionId(): string | undefined {
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = randomId();
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

function describe(error: unknown): { type: string; message: string; stack?: string } {
  if (error instanceof Error) return { type: error.name || 'Error', message: error.message || '', stack: error.stack };
  if (typeof error === 'string') return { type: 'Error', message: error };
  try {
    return { type: 'NonErrorThrown', message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { type: 'NonErrorThrown', message: String(error) };
  }
}

function endpoint(): string {
  return isProtectedPath(window.location.pathname) ? '/api/bff/telemetry/errors' : '/api/telemetry/errors';
}

function flush(): void {
  flushTimer = null;
  if (pending.length === 0) return;
  const events = pending.splice(0, ERROR_LIMITS.batchItems);
  try {
    void fetch(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ events }),
    }).catch(() => undefined);
  } catch {
    // Never report the reporter.
  }
  if (pending.length > 0) scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

/**
 * Records an error and returns its short user-facing code (null when the
 * event was deduplicated or over the per-page cap, in which case no code
 * could be found by support).
 */
export function reportError(error: unknown, options: { severity?: ErrorSeverity; extra?: string; frame?: string } = {}): string | null {
  try {
    if (typeof window === 'undefined') return null;
    if (error && typeof error === 'object' && codes.has(error)) return codes.get(error) ?? null;
    const described = describe(error);
    const type = truncate(scrubPii(described.type, ERROR_LIMITS.typeLength) || 'Error', ERROR_LIMITS.typeLength);
    const rawMessage = options.extra ? `${described.message} (${options.extra})` : described.message;
    const message = truncate(scrubPii(rawMessage, ERROR_LIMITS.messageLength * 2), ERROR_LIMITS.messageLength);
    // Without an Error object (cross-script errors, string throws) the script URL, line and column of the
    // ErrorEvent still let the API resolve the location with the release's source maps.
    const rawStack = described.stack ?? (options.frame ? `${type}: ${described.message}\n    at ${options.frame}` : undefined);
    const stack = rawStack ? truncate(scrubPii(rawStack, ERROR_LIMITS.stackLength * 2), ERROR_LIMITS.stackLength) : undefined;
    if (!dedupe.accept('web', errorFingerprint({ source: 'web', type, message, stack }), Date.now())) return null;
    if (sent >= MAX_EVENTS_PER_PAGE) return null;
    sent++;
    const eventId = randomId();
    pending.push({
      eventId,
      source: 'web',
      severity: options.severity ?? 'error',
      release,
      environment,
      route: normalizeRoute(window.location.pathname),
      type,
      message,
      ...(stack ? { stack } : {}),
      breadcrumbs: crumbs.slice(-ERROR_LIMITS.breadcrumbs),
      timestamp: new Date().toISOString(),
      sessionId: sessionId(),
    });
    scheduleFlush();
    const code = errorCodeFromId(eventId);
    if (error && typeof error === 'object') {
      codes.set(error, code);
      eventIds.set(error, eventId);
    }
    return code;
  } catch {
    return null;
  }
}

/** The id of the event reported for this error object, when it was reported from this page. */
export function eventIdOf(error: unknown): string | null {
  return error && typeof error === 'object' ? (eventIds.get(error) ?? null) : null;
}

/**
 * Sends the optional "what were you doing" note of an error screen (H3). The
 * text is scrubbed here and again by the API; there is no e-mail field.
 * Resolves true when the API accepted it. Never throws.
 */
export async function sendErrorFeedback(eventId: string, text: string): Promise<boolean> {
  try {
    const feedback = truncate(scrubPii(text, ERROR_FEEDBACK_MAX_LENGTH * 4), ERROR_FEEDBACK_MAX_LENGTH).trim();
    if (!feedback) return false;
    const base = isProtectedPath(window.location.pathname) ? '/api/bff/telemetry/errors' : '/api/telemetry/errors';
    const res = await fetch(`${base}/${encodeURIComponent(eventId)}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE },
      credentials: 'same-origin',
      body: JSON.stringify({ feedback, sessionId: sessionId() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
