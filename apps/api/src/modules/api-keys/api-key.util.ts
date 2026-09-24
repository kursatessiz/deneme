import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/**
 * API key format: pk_live_<prefix>_<secret>. The prefix (8 url-safe chars)
 * is stored in the clear and shown in listings so a key can be recognised;
 * the secret (32 url-safe chars) is only ever returned once, at creation or
 * rotation, and only its sha256 hash is stored.
 */
const PREFIX_LENGTH = 8;
const SECRET_LENGTH = 32;
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
  /** sha256 hex digest of the secret part, stored instead of the plaintext. */
  secretHash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomToken(PREFIX_LENGTH);
  const secret = randomToken(SECRET_LENGTH);
  return {
    plaintext: `pk_live_${prefix}_${secret}`,
    prefix,
    secretHash: hashSecret(secret),
  };
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
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
export function verifySecret(candidateSecret: string, storedHash: string): boolean {
  const candidateHash = hashSecret(candidateSecret);
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
