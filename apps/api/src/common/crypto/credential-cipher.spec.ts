import { ConfigService } from '@nestjs/config';
import { CredentialCipher } from './credential-cipher';

function configWith(value: string | undefined): ConfigService {
  return { get: () => value } as unknown as ConfigService;
}

describe('CredentialCipher', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64');

  it('round-trips plaintext through AES-256-GCM when a key is configured', () => {
    const cipher = new CredentialCipher(configWith(KEY));
    expect(cipher.isConfigured).toBe(true);
    const secret = JSON.stringify({ apiKey: 'abc', webhookSecret: 'whsec_123' });
    const encoded = cipher.encrypt(secret);
    expect(encoded).not.toContain('whsec_123');
    expect(cipher.decrypt(encoded)).toBe(secret);
  });

  it('produces a different ciphertext each time (random iv)', () => {
    const cipher = new CredentialCipher(configWith(KEY));
    const a = cipher.encrypt('same-secret');
    const b = cipher.encrypt('same-secret');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('same-secret');
    expect(cipher.decrypt(b)).toBe('same-secret');
  });

  it('rejects a key that does not decode to exactly 32 bytes', () => {
    expect(() => new CredentialCipher(configWith(Buffer.alloc(16).toString('base64')))).toThrow();
  });

  it('falls back to a reversible plaintext envelope when no key is configured (dev/test)', () => {
    const cipher = new CredentialCipher(configWith(undefined));
    expect(cipher.isConfigured).toBe(false);
    const encoded = cipher.encrypt('dev-secret');
    expect(cipher.decrypt(encoded)).toBe('dev-secret');
  });

  it('detects tampering: flipping a byte breaks decryption', () => {
    const cipher = new CredentialCipher(configWith(KEY));
    const encoded = cipher.encrypt('tamper-me');
    const buf = Buffer.from(encoded, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => cipher.decrypt(tampered)).toThrow();
  });
});
