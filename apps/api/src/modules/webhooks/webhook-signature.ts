import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signs a webhook delivery body the way Stripe-style signature headers do:
 * `X-Signature: t=<unix seconds>,v1=<hex hmac-sha256 of "${t}.${body}">`.
 * Documented with a verification example in docs/PUBLIC_API.md.
 */
export function signWebhookPayload(secret: string, timestampSeconds: number, rawBody: string): string {
  const signedContent = `${timestampSeconds}.${rawBody}`;
  return createHmac('sha256', secret).update(signedContent).digest('hex');
}

export function buildSignatureHeader(secret: string, rawBody: string, now = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  const v1 = signWebhookPayload(secret, t, rawBody);
  return `t=${t},v1=${v1}`;
}

export interface ParsedSignatureHeader {
  timestamp: number;
  signature: string;
}

export function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key?.trim(), value?.trim()];
    }),
  );
  const t = Number(parts['t']);
  const v1 = parts['v1'];
  if (!Number.isFinite(t) || !v1) return null;
  return { timestamp: t, signature: v1 };
}

/** Verifies a received `X-Signature` header against the body and secret; optionally bounds its age. */
export function verifySignatureHeader(
  secret: string,
  rawBody: string,
  header: string,
  maxAgeSeconds = 5 * 60,
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(Date.now() / 1000 - parsed.timestamp) > maxAgeSeconds) return false;
  const expected = signWebhookPayload(secret, parsed.timestamp, rawBody);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parsed.signature, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
