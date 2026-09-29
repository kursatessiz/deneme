import { ConfigService } from '@nestjs/config';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { Readable } from 'stream';
import { S3Client } from './s3/s3-client';

/** Injection token for the off-site store; e2e tests replace it with an in-memory store. */
export const BACKUP_STORE = Symbol('BACKUP_STORE');
/** Injection token for the host backup directory lister. */
export const LOCAL_BACKUP_LISTER = Symbol('LOCAL_BACKUP_LISTER');

export interface StoredObject {
  key: string;
  size: number;
  lastModified: Date;
}

export interface OffsiteStoreInfo {
  bucket: string;
  prefix: string;
  endpointHost: string;
}

/** Off-site object storage as the backup feature uses it. */
export interface OffsiteBackupStore {
  readonly configured: boolean;
  readonly info: OffsiteStoreInfo | null;
  list(): Promise<StoredObject[]>;
  getText(key: string): Promise<string | null>;
  getStream(key: string): Promise<Readable>;
  /** Streams to the store; returns the byte count. */
  upload(key: string, body: Readable): Promise<number>;
  putText(key: string, text: string): Promise<void>;
  delete(key: string): Promise<void>;
  presignGet(key: string, expiresSeconds: number): string;
}

export interface LocalBackupFile {
  name: string;
  size: number;
  modifiedAt: Date;
}

export interface LocalBackupLister {
  readonly configured: boolean;
  list(): Promise<LocalBackupFile[]>;
}

/** Parts of 8 MiB: above the 5 MiB S3 minimum, small enough for the 512 MB heap. */
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024;

/**
 * Streams `body` into the store as a multipart upload (one PutObject when it
 * fits in a single part). Aborts the multipart upload on any failure so no
 * orphaned parts are billed.
 */
export async function uploadStream(client: S3Client, key: string, body: Readable, partSize = MULTIPART_PART_SIZE): Promise<number> {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let total = 0;
  let uploadId: string | null = null;
  const parts: Array<{ partNumber: number; etag: string }> = [];

  const sendPart = async (buf: Buffer) => {
    if (uploadId === null) uploadId = await client.createMultipartUpload(key);
    const partNumber = parts.length + 1;
    parts.push({ partNumber, etag: await client.uploadPart(key, uploadId, partNumber, buf) });
  };

  try {
    for await (const chunk of body) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      pending.push(b);
      pendingBytes += b.length;
      total += b.length;
      if (pendingBytes >= partSize) {
        let all = Buffer.concat(pending, pendingBytes);
        while (all.length >= partSize) {
          await sendPart(all.subarray(0, partSize));
          all = all.subarray(partSize);
        }
        pending = all.length > 0 ? [all] : [];
        pendingBytes = all.length;
      }
    }
    const rest = Buffer.concat(pending, pendingBytes);
    if (uploadId === null) {
      await client.put(key, rest);
    } else {
      if (rest.length > 0) await sendPart(rest);
      await client.completeMultipartUpload(key, uploadId, parts);
    }
    return total;
  } catch (err) {
    if (uploadId !== null) await client.abortMultipartUpload(key, uploadId).catch(() => undefined);
    throw err;
  }
}

export class S3BackupStore implements OffsiteBackupStore {
  readonly configured = true;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly prefix: string,
  ) {}

  get info(): OffsiteStoreInfo {
    return { bucket: this.bucket, prefix: this.prefix, endpointHost: this.client.endpointHost };
  }

  async list(): Promise<StoredObject[]> {
    return this.client.list(this.prefix ? `${this.prefix}/` : '');
  }
  getText(key: string) {
    return this.client.getText(key);
  }
  getStream(key: string) {
    return this.client.getStream(key);
  }
  upload(key: string, body: Readable) {
    return uploadStream(this.client, key, body);
  }
  putText(key: string, text: string) {
    return this.client.put(key, Buffer.from(text, 'utf8'), 'text/plain');
  }
  delete(key: string) {
    return this.client.delete(key);
  }
  presignGet(key: string, expiresSeconds: number) {
    return this.client.presignGet(key, expiresSeconds);
  }
}

/** Used when BACKUP_S3_BUCKET is unset: lists nothing, refuses writes. */
export class UnconfiguredBackupStore implements OffsiteBackupStore {
  readonly configured = false;
  readonly info = null;
  async list(): Promise<StoredObject[]> {
    return [];
  }
  async getText(): Promise<string | null> {
    return null;
  }
  getStream(): Promise<Readable> {
    return Promise.reject(new Error('off-site store not configured'));
  }
  upload(): Promise<number> {
    return Promise.reject(new Error('off-site store not configured'));
  }
  putText(): Promise<void> {
    return Promise.reject(new Error('off-site store not configured'));
  }
  delete(): Promise<void> {
    return Promise.reject(new Error('off-site store not configured'));
  }
  presignGet(): string {
    throw new Error('off-site store not configured');
  }
}

export function createOffsiteStore(config: ConfigService): OffsiteBackupStore {
  const bucket = config.get<string>('BACKUP_S3_BUCKET');
  const accessKeyId = config.get<string>('BACKUP_S3_ACCESS_KEY_ID');
  const secretAccessKey = config.get<string>('BACKUP_S3_SECRET_ACCESS_KEY');
  if (!bucket || !accessKeyId || !secretAccessKey) return new UnconfiguredBackupStore();
  const region = config.get<string>('BACKUP_S3_REGION') ?? 'us-east-1';
  const endpoint = config.get<string>('BACKUP_S3_ENDPOINT') ?? `https://s3.${region}.amazonaws.com`;
  const prefix = config.get<string>('BACKUP_S3_PREFIX') ?? 'db';
  return new S3BackupStore(new S3Client({ endpoint, bucket, region, accessKeyId, secretAccessKey }), bucket, prefix);
}

/**
 * Lists the host's /opt/app/backups through a read-only mount. The API only
 * needs to list and stat: the directory is group-readable for the
 * container's group while the dump files themselves stay 0600 root
 * (deploy/scripts/backup.sh), so the API never reads a plaintext dump.
 */
export class DirectoryBackupLister implements LocalBackupLister {
  constructor(private readonly dir: string | undefined) {}

  get configured(): boolean {
    return Boolean(this.dir);
  }

  async list(): Promise<LocalBackupFile[]> {
    if (!this.dir) return [];
    const names = await readdir(this.dir);
    const out: LocalBackupFile[] = [];
    for (const name of names) {
      if (!/^db_.*\.sql\.gz$/.test(name)) continue;
      const s = await stat(join(this.dir, name)).catch(() => null);
      if (s?.isFile()) out.push({ name, size: s.size, modifiedAt: s.mtime });
    }
    return out;
  }
}
