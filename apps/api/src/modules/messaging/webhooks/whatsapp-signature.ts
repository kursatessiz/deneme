import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Meta signs every webhook POST with `X-Hub-Signature-256: sha256=<hex>`,
 * an HMAC-SHA256 of the exact raw request body keyed with the app secret.
 * Constant-time comparison; any malformed header is a mismatch.
 */
export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Test and tooling helper: the header value Meta would send for this body. */
export function signMetaBody(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}
