import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed references for the public tracking endpoints (docs/MESAJLASMA.md,
 * "İzleme"). A token is `<payload>.<mac>`, both base64url:
 *   payload = "v1:<kind>:<uuid>"  (o = open pixel, c = click link, u = unsubscribe)
 *   mac     = HMAC-SHA256(secret, payload)
 * The token only references a row (NotificationLog or MessageLink); the
 * redirect target lives server-side, so a token can never be turned into an
 * open redirect, and nothing personal is in the URL.
 */

export type TrackingKind = 'o' | 'c' | 'u';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TOKEN_LENGTH = 200;

function mac(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

export function signTrackingToken(secret: string, kind: TrackingKind, id: string): string {
  if (!UUID.test(id)) throw new Error('Tracking tokens only reference uuid rows');
  const payload = `v1:${kind}:${id}`;
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${mac(secret, payload).toString('base64url')}`;
}

/** The referenced id, or null for any malformed, tampered or wrong-kind token. */
export function verifyTrackingToken(secret: string, token: string, expectedKind: TrackingKind): string | null {
  if (!secret || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const encodedPayload = token.slice(0, dot);
  const encodedMac = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload) || !/^[A-Za-z0-9_-]+$/.test(encodedMac)) return null;
  const payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  const given = Buffer.from(encodedMac, 'base64url');
  const expected = mac(secret, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const parts = payload.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1' || parts[1] !== expectedKind || !UUID.test(parts[2])) return null;
  return parts[2];
}
