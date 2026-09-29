import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Small, pure building blocks of the OAuth connect flow (M4a). Nothing here
 * touches the database or the network, so the unit tests pin them down
 * exactly (RFC 7636 S256 vector, masking, redaction).
 */

/** A fresh one-time state: 32 random bytes, base64url (43 characters, no padding). */
export function generateOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What is stored for a state, hex. The raw value only travels in the browser
 * redirect. The state is a 256-bit random token, so a plain digest would be
 * enough; the key-stretched form (PBKDF2, fixed application salt) is used so
 * the stored value is never a fast hash of a credential, as a defence in
 * depth. Deterministic, so the callback can look the row up by it.
 */
export function hashOAuthState(state: string): string {
  return pbkdf2Sync(state, 'platform-oauth-state-v1', OAUTH_STATE_HASH_ITERATIONS, 32, 'sha256').toString('hex');
}

/** Iterations of the state hash: cheap enough for one call per start and per callback. */
const OAUTH_STATE_HASH_ITERATIONS = 10_000;

/** PKCE code verifier (RFC 7636 4.1): 32 random bytes, base64url, 43 characters from the unreserved set. */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** PKCE S256 challenge (RFC 7636 4.2): BASE64URL(SHA256(ASCII(verifier))). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Constant-time comparison of two hex digests; false for different lengths or non-hex input. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]*$/i.test(a) || !/^[0-9a-f]*$/i.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** Display form of a secret: never more than its last four characters. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return `****${value.slice(-4)}`;
}

/** Last four characters kept in the clear for display, or null. */
export function last4(value: string | null | undefined): string | null {
  return value ? value.slice(-4) : null;
}

/** Replaces every occurrence of the given secrets in a text (defence in depth before anything is stored). */
export function redactSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out;
}

/**
 * A provider-supplied error code reduced to something safe to store in an
 * audit row: letters, digits, `_`, `.`, `-`, at most 60 characters. Free
 * text (descriptions, messages) is never kept; anything else becomes
 * `unknown`.
 */
export function sanitizeProviderCode(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return 'unknown';
  const text = String(value);
  return /^[A-Za-z0-9_.-]{1,60}$/.test(text) ? text : 'unknown';
}
