/**
 * The auth endpoints whose JSON body carries `accessToken`/`refreshToken`.
 * The BFF turns those into httpOnly cookies and strips them from the body
 * it sends back to the browser, so the tokens never reach client JS.
 */
const TOKEN_ISSUING_PATHS = new Set(['auth/login', 'auth/otp/verify', 'auth/pin/login', 'auth/refresh']);

export function isTokenIssuingPath(apiPath: string): boolean {
  return TOKEN_ISSUING_PATHS.has(apiPath);
}

export function isLogoutPath(apiPath: string): boolean {
  return apiPath === 'auth/logout';
}
