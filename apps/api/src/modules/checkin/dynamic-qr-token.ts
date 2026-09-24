import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Member's dynamic check-in QR (W17): a short-lived HMAC-signed token, not a
 * JWT. It carries no bearer authority by itself (it is not accepted by
 * JwtAuthGuard) -- only StaffCheckInMemberQr / kiosk check-in endpoints
 * verify it, against a key derived from JWT_SECRET with a distinct purpose
 * label so it can never be confused with an access/refresh/kiosk JWT signed
 * with the same secret.
 */

const TTL_MS = 60_000;
/** Small allowance for clock skew between the phone that signed a request and this server. */
const CLOCK_SKEW_MS = 5_000;
const PURPOSE_LABEL = 'dynamic-member-qr:v1';

export interface DynamicQrPayload {
  membershipId: string;
  studioId: string;
  iat: number;
  nonce: string;
}

export type DynamicQrVerifyError = 'MALFORMED' | 'TAMPERED' | 'EXPIRED';

export type DynamicQrVerifyResult =
  | { ok: true; payload: DynamicQrPayload }
  | { ok: false; error: DynamicQrVerifyError };

function deriveKey(jwtSecret: string): Buffer {
  return createHmac('sha256', jwtSecret).update(PURPOSE_LABEL).digest();
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function signDynamicQrToken(
  jwtSecret: string,
  membershipId: string,
  studioId: string,
  now: number = Date.now(),
): { token: string; expiresAt: Date } {
  const payload: DynamicQrPayload = {
    membershipId,
    studioId,
    iat: now,
    nonce: randomBytes(16).toString('base64url'),
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', deriveKey(jwtSecret)).update(body).digest('base64url');
  return { token: `${body}.${signature}`, expiresAt: new Date(now + TTL_MS) };
}

export function verifyDynamicQrToken(jwtSecret: string, token: string, now: number = Date.now()): DynamicQrVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, error: 'MALFORMED' };
  }
  const [body, signature] = parts;

  const expectedSignature = createHmac('sha256', deriveKey(jwtSecret)).update(body).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return { ok: false, error: 'TAMPERED' };
  }

  let payload: DynamicQrPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as DynamicQrPayload;
  } catch {
    return { ok: false, error: 'MALFORMED' };
  }
  if (
    typeof payload?.membershipId !== 'string' ||
    !payload.membershipId ||
    typeof payload.studioId !== 'string' ||
    !payload.studioId ||
    typeof payload.iat !== 'number' ||
    typeof payload.nonce !== 'string' ||
    !payload.nonce
  ) {
    return { ok: false, error: 'MALFORMED' };
  }

  if (payload.iat > now + CLOCK_SKEW_MS || now - payload.iat > TTL_MS) {
    return { ok: false, error: 'EXPIRED' };
  }

  return { ok: true, payload };
}
