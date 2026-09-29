import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'crypto';
import type { Decipher } from 'crypto';
import { Transform } from 'stream';
import type { TransformCallback } from 'stream';
import { promisify } from 'util';

/**
 * The exact format of
 *   openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY
 * (deploy/scripts/backup.sh), so API-made and host-made backups decrypt with
 * the same documented command: the 8-byte magic "Salted__", an 8-byte random
 * salt, then AES-256-CBC with PKCS#7 padding. Key and IV are the first 32 and
 * next 16 bytes of PBKDF2-HMAC-SHA256(passphrase, salt, 200000) (the OpenSSL 3
 * default digest for -pbkdf2).
 */

export const OPENSSL_MAGIC = Buffer.from('Salted__', 'ascii');
export const OPENSSL_PBKDF2_ITERATIONS = 200_000;
const SALT_LEN = 8;
const HEADER_LEN = OPENSSL_MAGIC.length + SALT_LEN;

const pbkdf2Async = promisify(pbkdf2);

export async function deriveKeyIv(passphrase: string, salt: Buffer, iterations = OPENSSL_PBKDF2_ITERATIONS): Promise<{ key: Buffer; iv: Buffer }> {
  const out = await pbkdf2Async(Buffer.from(passphrase, 'utf8'), salt, iterations, 48, 'sha256');
  return { key: out.subarray(0, 32), iv: out.subarray(32, 48) };
}

/** Encrypting transform; the salt is random unless a test pins it. */
export async function createEncryptStream(passphrase: string, opts: { salt?: Buffer; iterations?: number } = {}): Promise<Transform> {
  const salt = opts.salt ?? randomBytes(SALT_LEN);
  if (salt.length !== SALT_LEN) throw new Error('salt must be 8 bytes');
  const { key, iv } = await deriveKeyIv(passphrase, salt, opts.iterations);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let headerSent = false;
  const header = (t: Transform) => {
    if (!headerSent) {
      t.push(Buffer.concat([OPENSSL_MAGIC, salt]));
      headerSent = true;
    }
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      header(this);
      cb(null, cipher.update(chunk));
    },
    flush(cb) {
      header(this);
      try {
        cb(null, cipher.final());
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

export class BackupDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupDecryptError';
  }
}

/** Decrypting transform for the same format; fails on a missing header or a wrong key (bad padding). */
export function createDecryptStream(passphrase: string, opts: { iterations?: number } = {}): Transform {
  let header: Buffer = Buffer.alloc(0);
  let decipher: Decipher | null = null;
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (decipher) {
        cb(null, decipher.update(chunk));
        return;
      }
      header = Buffer.concat([header, chunk]);
      if (header.length < HEADER_LEN) {
        cb();
        return;
      }
      if (!header.subarray(0, OPENSSL_MAGIC.length).equals(OPENSSL_MAGIC)) {
        cb(new BackupDecryptError('missing Salted__ header'));
        return;
      }
      const salt = header.subarray(OPENSSL_MAGIC.length, HEADER_LEN);
      const rest = header.subarray(HEADER_LEN);
      deriveKeyIv(passphrase, salt, opts.iterations).then(
        ({ key, iv }) => {
          decipher = createDecipheriv('aes-256-cbc', key, iv);
          cb(null, rest.length > 0 ? decipher.update(rest) : undefined);
        },
        (err: Error) => cb(err),
      );
    },
    flush(cb: TransformCallback) {
      if (!decipher) {
        cb(new BackupDecryptError('input shorter than the header'));
        return;
      }
      try {
        cb(null, decipher.final());
      } catch {
        cb(new BackupDecryptError('bad decrypt (wrong key or truncated file)'));
      }
    },
  });
}
