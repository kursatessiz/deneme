import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, hotp, otpauthUrl, totpAt, verifyTotp } from './totp';

// RFC 6238 Appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SEED = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET = base32Encode(RFC_SEED);

describe('base32', () => {
  it('encodes the RFC 4648 test vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
  });

  it('round-trips random secrets', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });
});

describe('HOTP (RFC 4226 Appendix D)', () => {
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [9, '520489'],
  ])('counter %i -> %s', (counter, expected) => {
    expect(hotp(RFC_SEED, counter)).toBe(expected);
  });
});

describe('TOTP (RFC 6238 Appendix B, SHA-1)', () => {
  // The RFC lists 8-digit values; the 6-digit code is their last six digits.
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i -> %s', (t, eight) => {
    expect(hotp(RFC_SEED, Math.floor(t / 30), 8)).toBe(eight);
    expect(totpAt(RFC_SECRET, t)).toBe(eight.slice(-6));
  });

  it('accepts one step of drift on either side and nothing further', () => {
    const t = 1111111111;
    const now = t * 1000;
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, t), now)).toBe(Math.floor(t / 30));
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, t - 30), now)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, t + 30), now)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, t - 90), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });
});

describe('helpers', () => {
  it('builds an otpauth URL with issuer and SHA1/6/30 parameters', () => {
    const url = otpauthUrl('JBSWY3DPEHPK3PXP', '+905321000001', 'Platform');
    expect(url.startsWith('otpauth://totp/Platform%3A%2B905321000001?')).toBe(true);
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
  });

  it('generates ten distinct formatted recovery codes', () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
  });
});
