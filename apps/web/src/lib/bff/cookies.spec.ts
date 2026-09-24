import {
  accessTokenCookieOptions,
  activeSelectionCookieOptions,
  expiredCookieOptions,
  refreshTokenCookieOptions,
} from './cookies';

describe('cookie options', () => {
  it('token cookies are always httpOnly', () => {
    expect(accessTokenCookieOptions('development').httpOnly).toBe(true);
    expect(refreshTokenCookieOptions('development').httpOnly).toBe(true);
  });

  it('the active-selection cookie is not httpOnly (the client reads it)', () => {
    expect(activeSelectionCookieOptions('production').httpOnly).toBe(false);
  });

  it('secure is only set in production', () => {
    expect(accessTokenCookieOptions('development').secure).toBe(false);
    expect(accessTokenCookieOptions('production').secure).toBe(true);
    expect(accessTokenCookieOptions(undefined).secure).toBe(false);
  });

  it('sameSite is always lax', () => {
    expect(accessTokenCookieOptions('production').sameSite).toBe('lax');
    expect(refreshTokenCookieOptions('production').sameSite).toBe('lax');
    expect(activeSelectionCookieOptions('production').sameSite).toBe('lax');
  });

  it('access token TTL is shorter than the refresh token TTL', () => {
    const access = accessTokenCookieOptions('production').maxAge!;
    const refresh = refreshTokenCookieOptions('production').maxAge!;
    expect(access).toBeLessThan(refresh);
  });

  it('the expired cookie has maxAge 0', () => {
    expect(expiredCookieOptions('production').maxAge).toBe(0);
  });
});
