import type { ErrorAlertNotification, ErrorAlertSink } from '@platform/shared';

/**
 * Outcome of one delivery attempt. It never carries the response body or the
 * destination URL: both may hold secrets, and failures are logged from it.
 */
export type AlertDeliveryOutcome =
  | { ok: true; statusCode: number }
  | { ok: false; statusCode: number | null; error: string; retryable: boolean };

/**
 * A destination for alerts besides e-mail (H3, docs/HATA_RAPORLAMA.md, "Uyarı
 * hedefleri"). An alert row is fanned out to every active sink; each sink gets
 * a scrubbed ErrorAlertNotification (a summary, never a stack, message or user
 * data) and answers with an outcome. The dispatcher owns retries with backoff,
 * so a sink only performs one attempt and classifies the failure.
 *
 * Adding a Sentry-like sink needs no change to capture or alert creation:
 *   1. add its kind to ERROR_ALERT_SINKS in packages/shared/src/error-alerts.ts;
 *   2. implement this interface: `isActive()` reads its own settings (stored
 *      encrypted with CredentialCipher, like the webhook and Slack settings)
 *      and `deliver()` maps the notification onto the service's event API,
 *      sending through AlertHttpClient so the host allow-list and the SSRF
 *      guard apply (add the fixed host to ERROR_ALERT_SINK_ALLOWED_HOSTS);
 *   3. register the class in the ALERT_SINKS factory of ErrorReportingModule.
 * No third-party SDK is needed or wanted: a hand-built HTTPS request is enough
 * for every sink shape used so far.
 */
export interface AlertSink {
  readonly kind: ErrorAlertSink;
  /** True when the sink is configured and switched on. */
  isActive(): Promise<boolean>;
  /** One delivery attempt. May throw; the dispatcher treats a throw as a retryable failure. */
  deliver(notification: ErrorAlertNotification): Promise<AlertDeliveryOutcome>;
}

/** DI token for the list of alert sinks. */
export const ALERT_SINKS = Symbol('ALERT_SINKS');

/** Shared HTTP status classification: 2xx delivered, 408, 429 and 5xx worth another try, other 4xx are final. */
export function outcomeForStatus(statusCode: number): AlertDeliveryOutcome {
  if (statusCode >= 200 && statusCode < 300) return { ok: true, statusCode };
  const retryable = statusCode === 408 || statusCode === 429 || statusCode >= 500;
  return { ok: false, statusCode, error: `HTTP ${statusCode}`, retryable };
}
