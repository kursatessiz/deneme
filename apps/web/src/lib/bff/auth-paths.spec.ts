import { isSessionUpgradePath, isTokenIssuingPath, isTokenIssuingRequest } from './auth-paths';

describe('token-issuing BFF paths', () => {
  it('turns login, two-step verification and invite acceptance responses into cookies', () => {
    for (const p of ['auth/login', 'auth/pin/login', 'auth/mfa/verify', 'auth/mfa/enroll/confirm', `invites/${'a'.repeat(43)}/accept`]) {
      expect(isTokenIssuingPath(p)).toBe(true);
    }
    expect(isTokenIssuingPath('auth/mfa/enroll')).toBe(false);
    expect(isTokenIssuingPath('invites/short/accept')).toBe(false);
    expect(isTokenIssuingPath(`invites/${'a'.repeat(43)}/otp`)).toBe(false);
  });

  it('forwards the current session only to the two-step verification upgrades', () => {
    expect(isSessionUpgradePath('auth/mfa/verify')).toBe(true);
    expect(isSessionUpgradePath('auth/mfa/enroll/confirm')).toBe(true);
    expect(isSessionUpgradePath('auth/login')).toBe(false);
    expect(isSessionUpgradePath(`invites/${'a'.repeat(43)}/accept`)).toBe(false);
  });
});

describe('token-issuing BFF requests', () => {
  it('turns the PIN change (PUT auth/pin) response into cookies, with the current session forwarded', () => {
    expect(isTokenIssuingRequest('PUT', 'auth/pin')).toBe(true);
    expect(isSessionUpgradePath('auth/pin')).toBe(true);
    expect(isTokenIssuingRequest('POST', 'auth/pin')).toBe(false);
  });

  it('keeps every other token-issuing path on POST only', () => {
    expect(isTokenIssuingRequest('POST', 'auth/login')).toBe(true);
    expect(isTokenIssuingRequest('GET', 'auth/login')).toBe(false);
    expect(isTokenIssuingRequest('PUT', 'auth/login')).toBe(false);
  });
});
