import { generateApiKey, hashSecret, parseApiKey, verifySecret } from './api-key.util';

describe('api-key.util', () => {
  it('generates a key matching the pk_live_<prefix>_<secret> format', () => {
    const key = generateApiKey();
    expect(key.plaintext).toMatch(/^pk_live_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
    expect(key.prefix).toHaveLength(8);
    expect(key.secretHash).toHaveLength(64);
  });

  it('never stores the plaintext secret, only its hash', () => {
    const key = generateApiKey();
    const parsed = parseApiKey(key.plaintext)!;
    expect(key.secretHash).toBe(hashSecret(parsed.secret, parsed.prefix));
    expect(key.secretHash).not.toContain(parsed.secret);
  });

  it('parses a well-formed key into prefix and secret', () => {
    const key = generateApiKey();
    const parsed = parseApiKey(key.plaintext);
    expect(parsed).not.toBeNull();
    expect(parsed!.prefix).toBe(key.prefix);
    expect(key.plaintext).toBe(`pk_live_${parsed!.prefix}_${parsed!.secret}`);
  });

  it('rejects malformed keys', () => {
    expect(parseApiKey('not-a-key')).toBeNull();
    expect(parseApiKey('pk_live_short_short')).toBeNull();
    expect(parseApiKey('pk_test_aaaaaaaa_' + 'a'.repeat(32))).toBeNull();
    expect(parseApiKey('')).toBeNull();
  });

  it('verifies the correct secret against its hash', () => {
    const key = generateApiKey();
    const parsed = parseApiKey(key.plaintext)!;
    expect(verifySecret(parsed.secret, parsed.prefix, key.secretHash)).toBe(true);
  });

  it('rejects an incorrect secret, including one of a different length', () => {
    const key = generateApiKey();
    expect(verifySecret('wrong-secret-wrong-secret-wrong', key.prefix, key.secretHash)).toBe(false);
    expect(verifySecret('short', key.prefix, key.secretHash)).toBe(false);
  });

  it('produces different keys on each call', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.prefix).not.toBe(b.prefix);
  });
});
