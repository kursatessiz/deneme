import {
  ClientErrorEventSchema,
  ERROR_LIMITS,
  ErrorDedupeWindow,
  errorCodeFromId,
  errorFingerprint,
  normalizeRoute,
  sampleEvent,
  scrubPii,
  truncate,
} from '@platform/shared';
import type { ClientErrorEvent, ErrorSeverity } from '@platform/shared';

import type { BreadcrumbBuffer } from './breadcrumbs';
import { ErrorQueue } from './queue';
import type { BatchSender, KeyValueStorage } from './queue';

/** Events one app session may report at most; a render loop must not flood the queue. */
export const MAX_EVENTS_PER_SESSION = 30;
const FLUSH_DELAY_MS = 1000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface ReporterContext {
  release: string;
  environment: string;
  /** Current screen route (already free of query and ids is not assumed: it is normalised here). */
  route: string | null;
}

export interface ReporterDeps {
  storage: KeyValueStorage;
  send: BatchSender;
  breadcrumbs: BreadcrumbBuffer;
  getContext: () => ReporterContext;
  now?: () => number;
  random?: () => number;
  /** Share of events kept, 0..1. The API exposes no public config yet, so the app default is 1. */
  sampleRate?: number;
  /** setTimeout by default; replaced in tests. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cap?: number;
}

export interface ReportOptions {
  severity?: ErrorSeverity;
  extra?: string;
}

export interface ReportResult {
  /** The 8-character code to show the user; null when the event was deduplicated, sampled out or over the cap. */
  code: string | null;
  /** Resolves once the event is on disk (a fatal crash may follow immediately). */
  persisted: Promise<void>;
}

/** RFC 4122 v4 from Math.random: ids need to be unique, not unguessable. */
export function randomUuid(random: () => number = Math.random): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join('');
  const variant = (8 + Math.floor(random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
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

/**
 * Mobile error reporter (H2, docs/HATA_RAPORLAMA.md): scrubs, deduplicates
 * and samples like the web reporter, persists every event in the offline
 * queue and flushes it in batches. Dependencies are injected so the logic
 * runs under plain Node in tests; runtime.ts wires the real ones.
 * report() never throws.
 */
export function createMobileReporter(deps: ReporterDeps) {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const queue = new ErrorQueue(deps.storage, deps.cap);
  const dedupe = new ErrorDedupeWindow(1000);
  const sessionId = randomUuid(random);
  /** error object -> code, so a boundary re-rendering shows the same code and reports once. */
  const codes = new WeakMap<object, string>();
  let reported = 0;
  let flushTimer: unknown = null;
  let retryTimer: unknown = null;
  let retryDelay = RETRY_BASE_MS;

  async function flush(): Promise<void> {
    try {
      const { remaining } = await queue.flush(deps.send);
      if (remaining > 0) {
        // One pending retry at a time, with backoff, while events remain queued (no connectivity library: polling is the fallback).
        if (retryTimer === null) {
          retryTimer = schedule(() => {
            retryTimer = null;
            void flush();
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        }
      } else {
        retryDelay = RETRY_BASE_MS;
      }
    } catch {
      // Never report the reporter.
    }
  }

  function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = schedule(() => {
      flushTimer = null;
      void flush();
    }, FLUSH_DELAY_MS);
  }

  function report(error: unknown, options: ReportOptions = {}): ReportResult {
    const none: ReportResult = { code: null, persisted: Promise.resolve() };
    try {
      if (error && typeof error === 'object' && codes.has(error)) return { code: codes.get(error) ?? null, persisted: Promise.resolve() };
      const described = describe(error);
      const type = truncate(scrubPii(described.type, ERROR_LIMITS.typeLength) || 'Error', ERROR_LIMITS.typeLength);
      const rawMessage = options.extra ? `${described.message} (${options.extra})` : described.message;
      const message = truncate(scrubPii(rawMessage, ERROR_LIMITS.messageLength * 2), ERROR_LIMITS.messageLength);
      const stack = described.stack ? truncate(scrubPii(described.stack, ERROR_LIMITS.stackLength * 2), ERROR_LIMITS.stackLength) : undefined;
      if (!dedupe.accept('mobile', errorFingerprint({ source: 'mobile', type, message, stack }), now())) return none;
      if (reported >= MAX_EVENTS_PER_SESSION) return none;
      if (!sampleEvent(deps.sampleRate ?? 1, random)) return none;
      reported++;

      const context = deps.getContext();
      const candidate = {
        eventId: randomUuid(random),
        source: 'mobile' as const,
        severity: options.severity ?? 'error',
        release: context.release,
        environment: context.environment,
        ...(context.route ? { route: normalizeRoute(context.route) } : {}),
        type,
        message,
        ...(stack ? { stack } : {}),
        breadcrumbs: deps.breadcrumbs.snapshot(),
        timestamp: new Date(now()).toISOString(),
        sessionId,
      };
      const parsed = ClientErrorEventSchema.safeParse(candidate);
      if (!parsed.success) return none;
      const event: ClientErrorEvent = parsed.data;
      const code = errorCodeFromId(event.eventId);
      if (error && typeof error === 'object') codes.set(error, code);
      const persisted = queue.enqueue(event);
      scheduleFlush();
      return { code, persisted };
    } catch {
      return none;
    }
  }

  return { report, flush, queue, sessionId };
}

export type MobileReporter = ReturnType<typeof createMobileReporter>;
