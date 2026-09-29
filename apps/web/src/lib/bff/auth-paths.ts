/**
 * The auth endpoints whose JSON body carries `accessToken`/`refreshToken`.
 * The BFF turns those into httpOnly cookies and strips them from the body
 * it sends back to the browser, so the tokens never reach client JS.
 */
const TOKEN_ISSUING_PATHS = new Set(['auth/login', 'auth/otp/verify', 'auth/pin/login', 'auth/refresh']);

/**
 * Token-issuing endpoints that act on the current session (M1 two-step
 * verification): the BFF forwards the access cookie to them, then swaps the
 * returned pair into the cookies like any other login.
 */
const SESSION_UPGRADE_PATHS = new Set(['auth/mfa/verify', 'auth/mfa/enroll/confirm']);

/** Web invite acceptance `/j/<token>`: `invites/<token>/accept` signs the new member in. */
const INVITE_ACCEPT_PATH = /^invites\/[A-Za-z0-9_-]{43}\/accept$/;

export function isTokenIssuingPath(apiPath: string): boolean {
  return TOKEN_ISSUING_PATHS.has(apiPath) || SESSION_UPGRADE_PATHS.has(apiPath) || INVITE_ACCEPT_PATH.test(apiPath);
}

export function isSessionUpgradePath(apiPath: string): boolean {
  return SESSION_UPGRADE_PATHS.has(apiPath);
}

export function isLogoutPath(apiPath: string): boolean {
  return apiPath === 'auth/logout';
}
