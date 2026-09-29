import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { isValidRequestId } from '@platform/shared';

/**
 * Per-request (or per-job) context carried through async calls: the
 * correlation id every log line and captured error is tagged with.
 */
export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

/** The incoming id when it is well formed, otherwise a fresh UUID. */
export function resolveRequestId(incoming: unknown): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return isValidRequestId(value) ? value : randomUUID();
}
