import { createHash } from 'crypto';
import { Transform, Writable } from 'stream';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { BackupDecryptError, createDecryptStream } from './backup-crypto';

export type VerifyFailure = 'SHA256_MISMATCH' | 'SIDECAR_MISSING' | 'DECRYPT_FAILED' | 'NOT_A_DUMP';

export interface StreamVerifyResult {
  sha256: string;
  sizeBytes: number;
  sqlBytes: number;
  failure: VerifyFailure | null;
}

const HEAD_BYTES = 512;
const TAIL_BYTES = 512;

/** First line of a pg_dump plain-format file and its closing comment. */
export const DUMP_HEAD_MARKER = 'PostgreSQL database dump';
export const DUMP_TAIL_MARKER = 'PostgreSQL database dump complete';

/** Parses a `sha256sum`-style sidecar ("<hex>" or "<hex>  <file>"). */
export function parseSidecar(text: string | null): string | null {
  if (!text) return null;
  const m = /^([0-9a-f]{64})\b/i.exec(text.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Reads the whole encrypted object once: sha256 of the ciphertext, full
 * decryption (a wrong key or a truncated file fails on the padding), gunzip,
 * and a check that the plaintext starts and ends like a pg_dump file.
 * Nothing is written anywhere; memory stays bounded.
 */
export async function verifyEncryptedStream(source: Readable, passphrase: string, expectedSha256: string | null): Promise<StreamVerifyResult> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  let sqlBytes = 0;
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);

  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      cb(null, chunk);
    },
  });
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      sqlBytes += chunk.length;
      if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk.subarray(0, HEAD_BYTES - head.length)]);
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > TAIL_BYTES) tail = tail.subarray(tail.length - TAIL_BYTES);
      cb();
    },
  });

  let failure: VerifyFailure | null = null;
  try {
    await pipeline(source, tap, createDecryptStream(passphrase), createGunzip(), sink);
  } catch (err) {
    // A wrong key, a truncated file or corrupt gzip is a verification
    // result; anything else (the download failed) is an error for the caller.
    const zlibError = typeof (err as { code?: unknown }).code === 'string' && (err as { code: string }).code.startsWith('Z_');
    if (!(err instanceof BackupDecryptError) && !zlibError) throw err;
    failure = 'DECRYPT_FAILED';
  }
  const sha256 = hash.digest('hex');
  if (!failure && expectedSha256 !== null && sha256 !== expectedSha256) failure = 'SHA256_MISMATCH';
  if (!failure) {
    const headText = head.toString('utf8');
    const tailText = tail.toString('utf8');
    if (!headText.startsWith('--') || !headText.includes(DUMP_HEAD_MARKER) || !tailText.includes(DUMP_TAIL_MARKER)) failure = 'NOT_A_DUMP';
  }
  return { sha256, sizeBytes, sqlBytes, failure };
}
