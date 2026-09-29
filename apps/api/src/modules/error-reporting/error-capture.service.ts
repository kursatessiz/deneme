import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import {
  ERROR_LIMITS,
  ErrorDedupeWindow,
  errorFingerprint,
  isValidRequestId,
  scrubBreadcrumbs,
  scrubPii,
  truncate,
} from '@platform/shared';
import type { Breadcrumb, ErrorEventRecord, ErrorSeverity, ErrorSource } from '@platform/shared';
import { ERROR_SINKS } from './error-sink';
import type { ErrorSink } from './error-sink';
import { currentRequestId } from './request-context';

export interface CaptureInput {
  source: ErrorSource;
  severity?: ErrorSeverity;
  /** The thrown value; type, message and stack are read from it unless given. */
  error?: unknown;
  type?: string;
  message?: string;
  stack?: string | null;
  route?: string | null;
  /** Defaults to the current request's correlation id. */
  requestId?: string | null;
  /** Only from an authenticated context or the server itself. */
  studioId?: string | null;
  /** Raw user id; hashed here and never stored. */
  userId?: string | null;
  statusCode?: number | null;
  breadcrumbs?: Breadcrumb[];
  /** Reporter-generated id (clients); a new UUID otherwise. */
  eventId?: string;
  release?: string;
  environment?: string;
  occurredAt?: Date;
}

/** Events waiting for the sinks; beyond this, new events are dropped (and counted). */
export const CAPTURE_QUEUE_LIMIT = 500;

function describe(error: unknown): { type: string; message: string; stack: string | null } {
  if (error instanceof Error) {
    return { type: error.name || error.constructor?.name || 'Error', message: error.message ?? '', stack: error.stack ?? null };
  }
  if (typeof error === 'string') return { type: 'Error', message: error, stack: null };
  let message = '';
  try {
    message = JSON.stringify(error) ?? String(error);
  } catch {
    message = String(error);
  }
  return { type: 'NonErrorThrown', message, stack: null };
}

/**
 * Fire-and-forget error capture (docs/HATA_RAPORLAMA.md). capture() only
 * scrubs, fingerprints, dedupes and enqueues -- synchronously, never
 * throwing and never awaiting I/O -- so it cannot block or break the
 * request that failed. A background drain hands each event to every sink,
 * isolating sink failures. The queue is bounded.
 */
@Injectable()
export class ErrorCaptureService implements OnModuleDestroy {
  private readonly logger = new Logger(ErrorCaptureService.name);
  private readonly queue: ErrorEventRecord[] = [];
  private readonly dedupe = new ErrorDedupeWindow(1000);
  private draining: Promise<void> | null = null;
  private scheduled = false;
  private closed = false;
  private dropped = 0;
  private readonly release: string;
  private readonly environment: string;
  private readonly salt: string;

  constructor(
    config: ConfigService,
    @Inject(ERROR_SINKS) private readonly sinks: ErrorSink[],
  ) {
    this.release = config.get<string>('APP_RELEASE') ?? 'dev';
    this.environment = config.get<string>('NODE_ENV') ?? 'development';
    const explicitSalt = config.get<string>('ERROR_USER_HASH_SALT');
    this.salt = explicitSalt ?? createHash('sha256').update(`error-user-hash:${config.get<string>('JWT_SECRET') ?? ''}`).digest('hex');
  }

  get currentRelease(): string {
    return this.release;
  }

  /** Events dropped because the queue was full (exposed for health checks and tests). */
  get droppedCount(): number {
    return this.dropped;
  }

  hashUserId(userId: string): string {
    return createHash('sha256').update(`${this.salt}:${userId}`).digest('hex');
  }

  /**
   * Records an error. Returns the event id when the event was queued, null
   * when it was deduplicated, dropped or capture failed. Never throws.
   */
  capture(input: CaptureInput): string | null {
    try {
      if (this.closed) return null;
      const described = input.error !== undefined ? describe(input.error) : { type: 'Error', message: '', stack: null };
      const type = truncate(scrubPii(input.type ?? described.type, ERROR_LIMITS.typeLength) || 'Error', ERROR_LIMITS.typeLength);
      const message = truncate(scrubPii(input.message ?? described.message, ERROR_LIMITS.messageLength * 2), ERROR_LIMITS.messageLength);
      const rawStack = input.stack !== undefined ? input.stack : described.stack;
      const stack = rawStack ? truncate(scrubPii(rawStack, ERROR_LIMITS.stackLength * 2), ERROR_LIMITS.stackLength) : null;
      const requestId = input.requestId !== undefined ? input.requestId : currentRequestId();
      const event: ErrorEventRecord = {
        eventId: input.eventId ?? randomUUID(),
        source: input.source,
        severity: input.severity ?? 'error',
        release: input.release ?? this.release,
        environment: input.environment ?? this.environment,
        route: input.route ? truncate(scrubPii(input.route, ERROR_LIMITS.routeLength), ERROR_LIMITS.routeLength) : null,
        requestId: requestId && isValidRequestId(requestId) ? requestId : null,
        studioId: input.studioId ?? null,
        userIdHash: input.userId ? this.hashUserId(input.userId) : null,
        type,
        message,
        stack,
        breadcrumbs: scrubBreadcrumbs(input.breadcrumbs),
        statusCode: input.statusCode ?? null,
        occurredAt: input.occurredAt ?? new Date(),
      };
      if (!this.dedupe.accept(event.source, errorFingerprint(event), Date.now())) return null;
      if (this.queue.length >= CAPTURE_QUEUE_LIMIT) {
        this.dropped++;
        return null;
      }
      this.queue.push(event);
      this.schedule();
      return event.eventId;
    } catch (err) {
      try {
        this.logger.warn(`Error capture failed: ${err instanceof Error ? err.name : 'unknown'}`);
      } catch {
        // Logging must not throw either.
      }
      return null;
    }
  }

  /** Resolves once every queued event has been handed to the sinks. */
  flush(): Promise<void> {
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    await Promise.race([this.flush(), new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]);
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      void this.flush();
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      for (const sink of this.sinks) {
        try {
          await sink.write(event);
        } catch (err) {
          // Never log the event itself: the sink failed, the event stays private.
          this.logger.warn(`Error sink ${sink.name} failed: ${err instanceof Error ? scrubPii(err.message, 300) : 'unknown'}`);
        }
      }
    }
  }
}
