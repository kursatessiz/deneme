import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * API key format: pk_live_<prefix>_<secret>. The prefix (8 url-safe chars)
 * is stored in the clear and shown in listings so a key can be recognised;
 * the secret (32 url-safe chars) is only ever returned once, at creation or
 * rotation, and only its scrypt hash (salted with the prefix) is stored.
 * The secret is ~190 bits of randomness, so a low scrypt cost is enough and
 * keeps per-request verification cheap.
 */
const PREFIX_LENGTH = 8;
const SECRET_LENGTH = 32;
/** Low cost on purpose: high-entropy random secrets, verified on every request. */
const SCRYPT_OPTIONS = { N: 1024, r: 8, p: 1 } as const;
const HASH_BYTES = 32;
const KEY_PATTERN = /^pk_live_([A-Za-z0-9]{8})_([A-Za-z0-9]{32})$/;

function randomToken(length: number): string {
  // base64url, trimmed/padded to an exact alphanumeric length so the key
  // format is fixed-width and easy to validate with a single regex.
  let out = '';
  while (out.length < length) {
    out += randomBytes(length).toString('base64url').replace(/[^A-Za-z0-9]/g, '');
  }
  return out.slice(0, length);
}

export interface GeneratedApiKey {
  /** Full plaintext key, shown to the caller exactly once. */
  plaintext: string;
  /** Non-secret prefix, safe to store and display. */
  prefix: string;
  /** scrypt hex digest of the secret part (salt: prefix), stored instead of the plaintext. */
  secretHash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomToken(PREFIX_LENGTH);
  const secret = randomToken(SECRET_LENGTH);
  return {
    plaintext: `pk_live_${prefix}_${secret}`,
    prefix,
    secretHash: hashSecret(secret, prefix),
  };
}

export function hashSecret(secret: string, prefix: string): string {
  return scryptSync(secret, `api-key:${prefix}`, HASH_BYTES, SCRYPT_OPTIONS).toString('hex');
}

export interface ParsedApiKey {
  prefix: string;
  secret: string;
}

/** Parses `pk_live_<prefix>_<secret>` from an Authorization header value. Returns null when malformed. */
export function parseApiKey(raw: string): ParsedApiKey | null {
  const match = KEY_PATTERN.exec(raw.trim());
  if (!match) return null;
  return { prefix: match[1], secret: match[2] };
}

/** Constant-time comparison of a candidate secret against the stored hash. */
export function verifySecret(candidateSecret: string, prefix: string, storedHash: string): boolean {
  const candidateHash = hashSecret(candidateSecret, prefix);
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
