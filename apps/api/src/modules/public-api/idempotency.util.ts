import { createHash } from 'crypto';

/** JSON with object keys sorted at every level, so two bodies that differ only in key order hash alike. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** What an Idempotency-Key is bound to: the method, the path and the body. The same key with anything else is refused. */
export function hashPublicRequest(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`, 'utf8').digest('hex');
}

/** An IN_PROGRESS claim older than this is treated as abandoned by a crashed request and may be claimed again. */
export const IDEMPOTENCY_CLAIM_STALE_MS = 2 * 60 * 1000;

export type ClaimState =
  | { kind: 'REPLAY' }
  | { kind: 'MISMATCH' }
  | { kind: 'IN_PROGRESS' }
  | { kind: 'STALE' };

/** What an existing record means for a new request carrying the same key. */
export function classifyExistingClaim(
  existing: { requestHash: string; status: string; createdAt: Date },
  requestHash: string,
  now: Date,
): ClaimState {
  if (existing.requestHash !== requestHash) return { kind: 'MISMATCH' };
  if (existing.status === 'DONE') return { kind: 'REPLAY' };
  return now.getTime() - existing.createdAt.getTime() > IDEMPOTENCY_CLAIM_STALE_MS ? { kind: 'STALE' } : { kind: 'IN_PROGRESS' };
}
