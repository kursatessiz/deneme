import { signDynamicQrToken, verifyDynamicQrToken } from './dynamic-qr-token';

const SECRET = 'unit-test-jwt-secret-0123456789abcdef';

describe('dynamic member QR token', () => {
  it('round-trips a freshly signed token', () => {
    const { token, expiresAt } = signDynamicQrToken(SECRET, 'membership-1', 'studio-1', 1_000_000);
    const result = verifyDynamicQrToken(SECRET, token, 1_000_000);
    expect(result).toEqual({
      ok: true,
      payload: { membershipId: 'membership-1', studioId: 'studio-1', iat: 1_000_000, nonce: expect.any(String) },
    });
    expect(expiresAt.getTime()).toBe(1_060_000);
  });

  it('is valid up to and including the 60s TTL boundary', () => {
    const { token } = signDynamicQrToken(SECRET, 'membership-1', 'studio-1', 1_000_000);
    expect(verifyDynamicQrToken(SECRET, token, 1_060_000).ok).toBe(true);
  });

  it('expires just after the TTL', () => {
    const { token } = signDynamicQrToken(SECRET, 'membership-1', 'studio-1', 1_000_000);
    const result = verifyDynamicQrToken(SECRET, token, 1_060_001);
    expect(result).toEqual({ ok: false, error: 'EXPIRED' });
  });

  it('tolerates a small amount of clock skew in the future', () => {
    const { token } = signDynamicQrToken(SECRET, 'membership-1', 'studio-1', 1_000_000);
    expect(verifyDynamicQrToken(SECRET, token, 999_000).ok).toBe(true);
  });

  it('rejects a token signed too far in the future for our clock', () => {
    const { token } = signDynamicQrToken(SECRET, 'membership-1', 'studio-1', 1_000_000);
    const result = verifyDynamicQrToken(SECRET, token, 994_000);
    expect(result).toEqual({ ok: false, error: 'EXPIRED' });
  });

  it('rejects a tampered payload', () => {
    const { token } = signDynamicQrToken(SECRET, 'membership-1', 'studio-1', 1_000_000);
    const [body, signature] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.studioId = 'studio-attacker';
    const tamperedBody = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const tampered = `${tamperedBody}.${signature}`;

    expect(verifyDynamicQrToken(SECRET, tampered, 1_000_000)).toEqual({ ok: false, error: 'TAMPERED' });
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = signDynamicQrToken(SECRET, 'membership-1', 'studio-1', 1_000_000);
    expect(verifyDynamicQrToken('a-completely-different-secret-value', token, 1_000_000)).toEqual({
      ok: false,
      error: 'TAMPERED',
    });
  });

  it('rejects malformed tokens', () => {
    expect(verifyDynamicQrToken(SECRET, 'not-a-token', 1_000_000)).toEqual({ ok: false, error: 'MALFORMED' });
    expect(verifyDynamicQrToken(SECRET, 'a.b.c', 1_000_000)).toEqual({ ok: false, error: 'MALFORMED' });
    expect(verifyDynamicQrToken(SECRET, '', 1_000_000)).toEqual({ ok: false, error: 'MALFORMED' });
  });

  it('rejects a body that decodes but is not a valid payload shape', () => {
    const body = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
    // Sign the bogus body with the real key so only the shape check can fail.
    const { createHmac } = require('crypto') as typeof import('crypto');
    const key = createHmac('sha256', SECRET).update('dynamic-member-qr:v1').digest();
    const signature = createHmac('sha256', key).update(body).digest('base64url');
    expect(verifyDynamicQrToken(SECRET, `${body}.${signature}`, 1_000_000)).toEqual({ ok: false, error: 'MALFORMED' });
  });

  it('produces a different nonce on every sign', () => {
    const a = signDynamicQrToken(SECRET, 'membership-1', 'studio-1', 1_000_000);
    const b = signDynamicQrToken(SECRET, 'membership-1', 'studio-1', 1_000_000);
    expect(a.token).not.toBe(b.token);
  });
});
