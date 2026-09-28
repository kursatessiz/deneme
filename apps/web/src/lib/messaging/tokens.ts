/**
 * Shape check for the API's signed tracking tokens (`<base64url>.<base64url>`)
 * before one is put into an API path. Verification itself happens in the
 * API; this only keeps arbitrary strings out of the proxied URL.
 */
const TOKEN = /^[A-Za-z0-9_-]{8,120}\.[A-Za-z0-9_-]{20,80}$/;

export function isTrackingToken(value: string): boolean {
  return TOKEN.test(value);
}
