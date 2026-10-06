import { HOST_NOT_ALLOWED_MESSAGE } from '../../ads/ads-http-client';
import type { AdsHttpResponse } from '../../ads/ads-http-client';
import { SocialPublishError } from '../social-publisher';

/** Graph API error codes that mean "slow down" rather than "this request is wrong". */
const GRAPH_RATE_LIMIT_CODES: ReadonlySet<number> = new Set([4, 17, 32, 613]);

const MAX_MESSAGE = 300;

/** A provider message trimmed and stripped of the credential, safe to store and show. */
export function sanitizeProviderMessage(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length >= 6) out = out.split(secret).join('[redacted]');
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE)}...` : out;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

interface GraphErrorBody {
  message: string | null;
  code: number | null;
  transient: boolean;
}

function graphErrorOf(body: unknown): GraphErrorBody {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : null;
  if (!error || typeof error !== 'object') return { message: typeof body === 'string' ? textOf(body) : null, code: null, transient: false };
  const e = error as { message?: unknown; code?: unknown; is_transient?: unknown };
  return { message: textOf(e.message), code: typeof e.code === 'number' ? e.code : null, transient: e.is_transient === true };
}

/** Turns a non-2xx Graph API answer into the failure the heartbeat understands. */
export function graphFailure(label: string, response: AdsHttpResponse, secrets: readonly string[]): SocialPublishError {
  const { message, code, transient } = graphErrorOf(response.body);
  const detail = sanitizeProviderMessage(message ?? `HTTP ${response.status}`, secrets);
  const text = `${label} ${response.status}${code !== null ? ` (code ${code})` : ''}: ${detail}`;
  const retryable = response.status === 429 || response.status >= 500 || transient || (code !== null && GRAPH_RATE_LIMIT_CODES.has(code));
  return new SocialPublishError(retryable ? 'RETRYABLE' : 'PERMANENT', text, response.status);
}

/** A thrown transport error (timeout, DNS, blocked host) as a failure; only a network error is worth retrying. */
export function transportFailure(label: string, err: unknown, secrets: readonly string[]): SocialPublishError {
  if (err instanceof SocialPublishError) return err;
  const raw = err instanceof Error ? err.message : 'unknown error';
  // A host refused by the allow-list is a programming error, not a transient one.
  const blocked = raw.includes(HOST_NOT_ALLOWED_MESSAGE);
  return new SocialPublishError(blocked ? 'PERMANENT' : 'RETRYABLE', `${label}: ${sanitizeProviderMessage(raw, secrets)}`, null);
}

export function stringField(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object') return null;
  return textOf((body as Record<string, unknown>)[key]);
}
