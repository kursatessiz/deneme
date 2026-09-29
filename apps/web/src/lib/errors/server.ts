import { ERROR_LIMITS, REQUEST_ID_HEADER, isValidRequestId, normalizeRoute, scrubPii, truncate } from '@platform/shared';
import type { ClientErrorEvent } from '@platform/shared';
import { apiInternalBaseUrl, getServerEnv } from '@/lib/server-env';

/** The incoming correlation id when well formed, otherwise a new one (web -> BFF -> API). */
export function requestIdFrom(headers: Pick<Headers, 'get'>): string {
  const incoming = headers.get(REQUEST_ID_HEADER);
  return isValidRequestId(incoming) ? incoming : crypto.randomUUID();
}

/**
 * Server-side report from the web tier itself (the BFF when the API is
 * unreachable or answers 5xx without recording it). Sent straight to the
 * API ingest over the internal network; fire and forget, never throws.
 */
export function reportServerError(input: { type: string; message: string; route: string; requestId: string }): void {
  try {
    const env = getServerEnv();
    const event: ClientErrorEvent = {
      eventId: crypto.randomUUID(),
      source: 'web',
      severity: 'error',
      release: env.APP_RELEASE,
      environment: env.NODE_ENV,
      route: normalizeRoute(input.route),
      requestId: input.requestId,
      type: truncate(input.type, ERROR_LIMITS.typeLength),
      message: truncate(scrubPii(input.message, ERROR_LIMITS.messageLength), ERROR_LIMITS.messageLength),
      timestamp: new Date().toISOString(),
    };
    void fetch(`${apiInternalBaseUrl()}/telemetry/errors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [REQUEST_ID_HEADER]: input.requestId },
      body: JSON.stringify({ events: [event] }),
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined);
  } catch {
    // Reporting must never break the proxied request.
  }
}
