import { PassThrough, Readable } from 'stream';
import type { LocalBackupFile, LocalBackupLister, OffsiteBackupStore, OffsiteStoreInfo, StoredObject } from '../../../src/modules/backups/backup-store';
import type { DatabaseDumper, DumpHandle } from '../../../src/modules/backups/pg-dumper';

/** In-memory S3 stand-in for the backup e2e suite. */
export class MemoryBackupStore implements OffsiteBackupStore {
  readonly configured = true;
  readonly info: OffsiteStoreInfo = { bucket: 'e2e-bucket', prefix: 'db', endpointHost: 'store.e2e.test' };
  readonly objects = new Map<string, { data: Buffer; lastModified: Date }>();

  put(key: string, data: Buffer | string, lastModified = new Date()): void {
    this.objects.set(key, { data: Buffer.isBuffer(data) ? data : Buffer.from(data), lastModified });
  }

  async list(): Promise<StoredObject[]> {
    return [...this.objects].filter(([k]) => k.startsWith('db/')).map(([key, o]) => ({ key, size: o.data.length, lastModified: o.lastModified }));
  }
  async getText(key: string): Promise<string | null> {
    return this.objects.get(key)?.data.toString('utf8') ?? null;
  }
  async getStream(key: string): Promise<Readable> {
    const o = this.objects.get(key);
    if (!o) throw new Error('NoSuchKey');
    return Readable.from([o.data]);
  }
  async upload(key: string, body: Readable): Promise<number> {
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(Buffer.from(c as Uint8Array));
    const data = Buffer.concat(chunks);
    this.put(key, data);
    return data.length;
  }
  async putText(key: string, text: string): Promise<void> {
    this.put(key, text);
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  presignGet(key: string, expiresSeconds: number): string {
    return `https://store.e2e.test/e2e-bucket/${key}?X-Amz-Expires=${expiresSeconds}&X-Amz-Signature=fake`;
  }
}

export class FakeLocalLister implements LocalBackupLister {
  readonly configured = true;
  files: LocalBackupFile[] = [];
  async list(): Promise<LocalBackupFile[]> {
    return this.files;
  }
}

export const FAKE_DUMP_SQL = '--\n-- PostgreSQL database dump\n--\n\nCREATE TABLE e2e_backup (id int);\n\n--\n-- PostgreSQL database dump complete\n--\n\n';

/** A pg_dump stand-in whose output is held until `release()`, so tests can observe a running backup. */
export class GatedDumper implements DatabaseDumper {
  private gate: Promise<void> = Promise.resolve();
  private open: () => void = () => undefined;
  dumps = 0;

  hold(): void {
    this.gate = new Promise((resolve) => (this.open = resolve));
  }
  release(): void {
    this.open();
  }

  dump(): DumpHandle {
    this.dumps++;
    const out = new PassThrough();
    const done = this.gate.then(() => {
      out.end(FAKE_DUMP_SQL);
    });
    return { stdout: out, done, kill: () => out.destroy() };
  }
}
