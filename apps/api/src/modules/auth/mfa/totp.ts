import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30 second steps, 6 digits) and the RFC 4648
 * base32 encoding authenticator apps expect. In-house on purpose: a few
 * lines of node:crypto instead of a new dependency (CLAUDE.md), covered by
 * the RFC 6238 test vectors in totp.spec.ts.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accepted clock drift in steps on either side of "now". */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit secret (RFC 4226 recommendation), base32 encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP value for one counter, zero-padded to `digits`. */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const msg = Buffer.alloc(8);
  // Counter as a 64-bit big-endian integer; JS numbers are exact up to 2^53.
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac(algorithm, key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpAt(secretBase32: string, unixSeconds: number): string {
  return hotp(base32Decode(secretBase32), Math.floor(unixSeconds / TOTP_PERIOD_SECONDS));
}

/**
 * Returns the matched time step (for replay protection) or null. Every
 * candidate in the window is compared in constant time.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs = Date.now(), window = TOTP_WINDOW): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretBase32);
  const step = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
  let matched: number | null = null;
  for (let delta = -window; delta <= window; delta++) {
    const candidate = Buffer.from(hotp(key, step + delta));
    if (timingSafeEqual(candidate, Buffer.from(code)) && matched === null) matched = step + delta;
  }
  return matched;
}

/** otpauth:// URL for authenticator apps (Key Uri Format). */
export function otpauthUrl(secretBase32: string, accountLabel: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Ten recovery codes, 10 base32 characters each, shown as xxxxx-xxxxx. */
export function generateRecoveryCodes(count: number): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Normalized (no dash, lowercase) code -> stored hash. */
export function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(`mfa-recovery:${normalized}`).digest('hex');
}
