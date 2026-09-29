import type { ErrorEventRecord } from '@platform/shared';

/**
 * Where captured errors go. The storage sink (Postgres) is the only
 * implementation in H1; an external service (e.g. Sentry) can be added
 * later as another sink without touching the capture points. A sink may
 * throw: ErrorCaptureService isolates every sink call.
 */
export interface ErrorSink {
  readonly name: string;
  write(event: ErrorEventRecord): Promise<void>;
}

/** DI token for the list of active sinks. */
export const ERROR_SINKS = Symbol('ERROR_SINKS');
