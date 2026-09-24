/**
 * Cookie names and options for the BFF session. Access and refresh tokens
 * are httpOnly: the browser never reads them, only the BFF route handlers
 * do. The active studio/branch are plain (non-httpOnly) cookies -- they are
 * not secrets, just a remembered UI choice the client also needs to read to
 * send `x-studio-id` on BFF calls.
 */
export const ACCESS_TOKEN_COOKIE = 'pw_access';
export const REFRESH_TOKEN_COOKIE = 'pw_refresh';
export const ACTIVE_STUDIO_COOKIE = 'pw_studio';
export const ACTIVE_BRANCH_COOKIE = 'pw_branch';

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge?: number;
  expires?: Date;
}

/** True in production only: local http dev would otherwise drop the cookie. */
function isProduction(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'production';
}

/** Options for the httpOnly access-token cookie. Short-lived, matches the API's access token TTL. */
export function accessTokenCookieOptions(nodeEnv: string | undefined): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(nodeEnv),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60, // 1h, mirrors AuthService.issueTokens
  };
}

/** Options for the httpOnly refresh-token cookie. Long-lived, matches the API's refresh token TTL. */
export function refreshTokenCookieOptions(nodeEnv: string | undefined): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(nodeEnv),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30d, mirrors AuthService.issueTokens
  };
}

/** Options for the plain active-studio/active-branch cookies the client also reads. */
export function activeSelectionCookieOptions(nodeEnv: string | undefined): CookieOptions {
  return {
    httpOnly: false,
    secure: isProduction(nodeEnv),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  };
}

/** Options that immediately expire a cookie, for logout / failed refresh. */
export function expiredCookieOptions(nodeEnv: string | undefined): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(nodeEnv),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  };
}
