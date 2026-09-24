import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Encrypts and decrypts per-studio partner credentials (PartnerConnection
 * .encryptedCredentials) with AES-256-GCM. The key comes from
 * INTEGRATION_ENCRYPTION_KEY (32 raw bytes, base64-encoded); env.ts requires
 * it in production whenever any partner connection could exist, and leaves
 * it optional in dev/test so the mock provider works without it - encrypt()
 * then stores plaintext instead of failing, which is fine because storing a
 * mock's dummy webhook secret carries no real risk.
 *
 * Encoded form: base64(iv(12) + authTag(16) + ciphertext).
 */
@Injectable()
export class CredentialCipher {
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('INTEGRATION_ENCRYPTION_KEY');
    if (!raw) {
      this.key = null;
      return;
    }
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== KEY_LENGTH) {
      throw new InternalServerErrorException('INTEGRATION_ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
    this.key = decoded;
  }

  get isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      // Dev/test fallback: no key configured, store as a clearly-marked
      // plaintext envelope so decrypt() can round-trip it symmetrically.
      return `plain:${Buffer.from(plaintext, 'utf8').toString('base64')}`;
    }
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(encoded: string): string {
    if (encoded.startsWith('plain:')) {
      return Buffer.from(encoded.slice('plain:'.length), 'base64').toString('utf8');
    }
    if (!this.key) {
      throw new InternalServerErrorException('INTEGRATION_ENCRYPTION_KEY is required to decrypt stored credentials');
    }
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
