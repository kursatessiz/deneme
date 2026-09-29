import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { UpdateBackupSettingsSchema } from '@platform/shared';
import { amzDate, presignUrl, signRequest, uriEncode } from './s3/sigv4';
import { S3Client, S3Error, parseListObjectsV2 } from './s3/s3-client';
import type { FetchLike } from './s3/s3-client';
import { uploadStream } from './backup-store';
import { createDecryptStream, createEncryptStream, OPENSSL_MAGIC } from './backup-crypto';
import { parseSidecar, verifyEncryptedStream } from './backup-verify';
import {
  buildBackupName,
  isScheduledBackupDue,
  isStale,
  latestSlot,
  nameFromObjectKey,
  newestVerified,
  nextSlot,
  objectKeyFor,
  parseBackupName,
  planRetention,
} from './backup-policy';
import { pgEnvFromUrl } from './pg-dumper';

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function encryptBuffer(plain: Buffer, pass: string, opts: { salt?: Buffer; iterations?: number } = {}): Promise<Buffer> {
  const enc = await createEncryptStream(pass, opts);
  const out: Buffer[] = [];
  await pipeline(Readable.from([plain]), enc, async (src: AsyncIterable<Buffer>) => {
    for await (const c of src) out.push(c);
  });
  return Buffer.concat(out);
}

async function decryptBuffer(cipher: Buffer, pass: string): Promise<Buffer> {
  const out: Buffer[] = [];
  await pipeline(Readable.from([cipher]), createDecryptStream(pass), async (src: AsyncIterable<Buffer>) => {
    for await (const c of src) out.push(c);
  });
  return Buffer.concat(out);
}

const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

// ---------------------------------------------------------------------------
// SigV4
// ---------------------------------------------------------------------------

describe('SigV4 signer', () => {
  // AWS S3 documentation examples ("Authenticating Requests: Using the
  // Authorization Header" / "Using Query Parameters").
  const creds = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };
  const date = new Date('2013-05-24T00:00:00Z');

  it('formats the amz date', () => {
    expect(amzDate(date)).toBe('20130524T000000Z');
  });

  it('matches the AWS GET object example signature', () => {
    const headers = signRequest(
      {
        method: 'GET',
        host: 'examplebucket.s3.amazonaws.com',
        path: '/test.txt',
        headers: { range: 'bytes=0-9' },
        payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      creds,
      date,
    );
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers).not.toHaveProperty('host');
  });

  it('matches the AWS presigned URL example signature', () => {
    const url = presignUrl({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', protocol: 'https:' }, creds, date, 86400);
    expect(url).toContain('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
    expect(url).toContain('X-Amz-Expires=86400');
    expect(url).not.toContain(creds.secretAccessKey);
    expect(url).not.toContain(encodeURIComponent(creds.secretAccessKey));
  });

  it('encodes like RFC 3986 and keeps slashes in key paths when asked', () => {
    expect(uriEncode('a b+c/d~e')).toBe('a%20b%2Bc%2Fd~e');
    expect(uriEncode('db/x y', false)).toBe('db/x%20y');
  });
});

// ---------------------------------------------------------------------------
// S3 client with a mocked HTTP layer
// ---------------------------------------------------------------------------

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}

function mockFetch(handler: (call: Call) => { status: number; body?: string | Buffer; headers?: Record<string, string> }): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const body = init.body ? Buffer.from(init.body as Uint8Array) : undefined;
    const call: Call = { url, method: String(init.method), headers: init.headers as Record<string, string>, body };
    calls.push(call);
    const r = handler(call);
    return new Response(r.body === undefined ? null : typeof r.body === 'string' ? r.body : new Uint8Array(r.body), { status: r.status, headers: r.headers });
  };
  return { fetch: fetchImpl, calls };
}

const clientConfig = { endpoint: 'https://s3.example.test', bucket: 'bk', region: 'eu-central-1', accessKeyId: 'AKID', secretAccessKey: 'very-secret-value' };

function listXml(keys: Array<[string, number, string]>, truncated: boolean, next?: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>' +
    `<IsTruncated>${truncated}</IsTruncated>` +
    keys.map(([k, s, d]) => `<Contents><Key>${k}</Key><LastModified>${d}</LastModified><Size>${s}</Size></Contents>`).join('') +
    (next ? `<NextContinuationToken>${next}</NextContinuationToken>` : '') +
    '</ListBucketResult>'
  );
}

describe('S3 client', () => {
  it('parses ListObjectsV2 pages including XML entities', () => {
    const parsed = parseListObjectsV2(listXml([['db/a&amp;b.enc', 10, '2026-10-18T01:00:00.000Z']], true, 'tok+/='));
    expect(parsed.objects).toEqual([{ key: 'db/a&b.enc', size: 10, lastModified: new Date('2026-10-18T01:00:00.000Z') }]);
    expect(parsed.isTruncated).toBe(true);
    expect(parsed.nextToken).toBe('tok+/=');
  });

  it('lists every page with path-style signed requests', async () => {
    const { fetch, calls } = mockFetch((call) =>
      call.url.includes('continuation-token')
        ? { status: 200, body: listXml([['db/two', 2, '2026-10-18T02:00:00Z']], false) }
        : { status: 200, body: listXml([['db/one', 1, '2026-10-18T01:00:00Z']], true, 'next/1') },
    );
    const client = new S3Client(clientConfig, fetch, () => new Date('2026-10-18T03:00:00Z'));
    const objects = await client.list('db/');
    expect(objects.map((o) => o.key)).toEqual(['db/one', 'db/two']);
    expect(calls[0].url).toBe('https://s3.example.test/bk?list-type=2&prefix=db%2F');
    expect(calls[1].url).toContain('continuation-token=next%2F1');
    expect(calls[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20261018\/eu-central-1\/s3\/aws4_request/);
    expect(JSON.stringify(calls)).not.toContain('very-secret-value');
  });

  it('returns null for a missing object and raises S3Error without secrets otherwise', async () => {
    const { fetch } = mockFetch((call) =>
      call.method === 'HEAD' ? { status: 404 } : { status: 403, body: '<Error><Code>AccessDenied</Code><Message>no</Message></Error>' },
    );
    const client = new S3Client(clientConfig, fetch);
    await expect(client.head('db/x')).resolves.toBeNull();
    const err = await client.getText('db/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect((err as S3Error).code).toBe('AccessDenied');
    expect((err as S3Error).message).not.toContain('very-secret-value');
  });

  it('uploads small bodies with one PUT and large ones as multipart', async () => {
    const puts: Call[] = [];
    const { fetch, calls } = mockFetch((call) => {
      if (call.method === 'PUT') {
        puts.push(call);
        return { status: 200, headers: { etag: `"e${puts.length}"` } };
      }
      if (call.url.includes('uploads=')) return { status: 200, body: '<InitiateMultipartUploadResult><UploadId>U1</UploadId></InitiateMultipartUploadResult>' };
      return { status: 200, body: '<CompleteMultipartUploadResult/>' };
    });
    const client = new S3Client(clientConfig, fetch);

    expect(await uploadStream(client, 'db/small', Readable.from([Buffer.from('abc')]), 8)).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://s3.example.test/bk/db/small');

    calls.length = 0;
    puts.length = 0;
    const data = Buffer.from('0123456789abcdefghij'); // 20 bytes, part size 8 -> 8 + 8 + 4
    expect(await uploadStream(client, 'db/big', Readable.from([data.subarray(0, 5), data.subarray(5)]), 8)).toBe(20);
    expect(puts.map((p) => p.body?.toString())).toEqual(['01234567', '89abcdef', 'ghij']);
    expect(puts[0].url).toContain('partNumber=1&uploadId=U1');
    const complete = calls[calls.length - 1];
    expect(complete.method).toBe('POST');
    expect(complete.body?.toString()).toContain('<PartNumber>3</PartNumber><ETag>"e3"</ETag>');
  });

  it('aborts the multipart upload when a part fails', async () => {
    const { fetch, calls } = mockFetch((call) => {
      if (call.method === 'PUT') return { status: 500, body: '<Error><Code>InternalError</Code></Error>' };
      if (call.url.includes('uploads=')) return { status: 200, body: '<InitiateMultipartUploadResult><UploadId>U2</UploadId></InitiateMultipartUploadResult>' };
      return { status: 204 };
    });
    const client = new S3Client(clientConfig, fetch);
    await expect(uploadStream(client, 'db/fail', Readable.from([Buffer.alloc(20)]), 8)).rejects.toBeInstanceOf(S3Error);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('uploadId=U2'))).toBe(true);
  });

  it('presigns a GET for the object without the secret', () => {
    const client = new S3Client(clientConfig, fetch, () => new Date('2026-10-18T03:00:00Z'));
    const url = client.presignGet('db/db_20261018_010000Z-api.sql.gz.enc', 300);
    expect(url.startsWith('https://s3.example.test/bk/db/db_20261018_010000Z-api.sql.gz.enc?')).toBe(true);
    expect(url).toContain('X-Amz-Expires=300');
    expect(url).not.toContain('very-secret-value');
  });
});

// ---------------------------------------------------------------------------
// Encryption format compatibility with `openssl enc`
// ---------------------------------------------------------------------------

describe('openssl-compatible encryption', () => {
  const pass = 'golden-passphrase-0123456789';

  it('matches a golden vector produced by openssl enc -aes-256-cbc -pbkdf2 -iter 200000', async () => {
    // openssl enc ... -S 0102030405060708 -pass env:K <<< "hello backup" (openssl 3 omits the header when -S is given)
    const out = await encryptBuffer(Buffer.from('hello backup\n'), pass, { salt: Buffer.from('0102030405060708', 'hex') });
    expect(out.subarray(0, 8).equals(OPENSSL_MAGIC)).toBe(true);
    expect(out.subarray(8, 16).toString('hex')).toBe('0102030405060708');
    expect(out.subarray(16).toString('hex')).toBe('466cf7713d419e89ec9322501aba3d91');
  });

  it('round-trips and rejects a wrong key', async () => {
    const plain = Buffer.from('x'.repeat(100_000));
    const cipher = await encryptBuffer(plain, pass);
    expect((await decryptBuffer(cipher, pass)).equals(plain)).toBe(true);
    await expect(decryptBuffer(cipher, 'another-passphrase-0000')).rejects.toThrow();
    await expect(decryptBuffer(Buffer.from('not encrypted at all'), pass)).rejects.toThrow(/Salted__/);
  });

  (hasOpenssl ? it : it.skip)('is readable by the documented openssl command and reads openssl output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'backup-spec-'));
    try {
      const plain = Buffer.from('-- PostgreSQL database dump\nSELECT 1;\n'.repeat(1000));
      writeFileSync(join(dir, 'api.enc'), await encryptBuffer(plain, pass));
      const env = { ...process.env, BACKUP_ENCRYPTION_KEY: pass };
      execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-pass', 'env:BACKUP_ENCRYPTION_KEY', '-in', join(dir, 'api.enc'), '-out', join(dir, 'api.out')], { env });
      expect(readFileSync(join(dir, 'api.out')).equals(plain)).toBe(true);

      writeFileSync(join(dir, 'host.in'), plain);
      execFileSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-salt', '-pass', 'env:BACKUP_ENCRYPTION_KEY', '-in', join(dir, 'host.in'), '-out', join(dir, 'host.enc')], { env });
      expect((await decryptBuffer(readFileSync(join(dir, 'host.enc')), pass)).equals(plain)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe('verifyEncryptedStream', () => {
  const pass = 'verify-passphrase-0123456789';
  const dump = Buffer.from('--\n-- PostgreSQL database dump\n--\nCREATE TABLE t ();\n--\n-- PostgreSQL database dump complete\n--\n');

  async function artifact(plain: Buffer): Promise<Buffer> {
    const gz: Buffer[] = [];
    await pipeline(Readable.from([plain]), createGzip(), async (src: AsyncIterable<Buffer>) => {
      for await (const c of src) gz.push(c);
    });
    return encryptBuffer(Buffer.concat(gz), pass);
  }

  it('accepts a good artifact and reports its sha256', async () => {
    const enc = await artifact(dump);
    const sha = createHash('sha256').update(enc).digest('hex');
    const r = await verifyEncryptedStream(Readable.from([enc]), pass, sha);
    expect(r).toEqual({ sha256: sha, sizeBytes: enc.length, sqlBytes: dump.length, failure: null });
  });

  it('flags a sha256 mismatch, a wrong key and a non-dump', async () => {
    const enc = await artifact(dump);
    expect((await verifyEncryptedStream(Readable.from([enc]), pass, '0'.repeat(64))).failure).toBe('SHA256_MISMATCH');
    expect((await verifyEncryptedStream(Readable.from([enc]), 'wrong-passphrase-000000', null)).failure).toBe('DECRYPT_FAILED');
    expect((await verifyEncryptedStream(Readable.from([enc.subarray(0, enc.length - 16)]), pass, null)).failure).toBe('DECRYPT_FAILED');
    const other = await artifact(Buffer.from('hello'));
    expect((await verifyEncryptedStream(Readable.from([other]), pass, null)).failure).toBe('NOT_A_DUMP');
  });

  it('rethrows download errors instead of calling them a bad backup', async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error('socket hang up'));
      },
    });
    await expect(verifyEncryptedStream(failing, pass, null)).rejects.toThrow('socket hang up');
  });

  it('parses sha256sum sidecars', () => {
    const hex = 'a'.repeat(64);
    expect(parseSidecar(`${hex}\n`)).toBe(hex);
    expect(parseSidecar(`${hex.toUpperCase()}  db_x.sql.gz.enc\n`)).toBe(hex);
    expect(parseSidecar('garbage')).toBeNull();
    expect(parseSidecar(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Names, schedule, retention
// ---------------------------------------------------------------------------

describe('backup names', () => {
  it('builds UTC names with the writer marker and parses all three forms', () => {
    const name = buildBackupName(new Date('2026-10-18T01:02:03.456Z'), 'api');
    expect(name).toBe('db_20261018_010203Z-api.sql.gz');
    expect(parseBackupName(name)).toEqual({ name, origin: 'api', stampUtc: new Date('2026-10-18T01:02:03Z') });
    expect(parseBackupName('db_20261018_023000Z-host.sql.gz')?.origin).toBe('host');
    expect(parseBackupName('db_20261018_053000.sql.gz')).toEqual({ name: 'db_20261018_053000.sql.gz', origin: 'legacy', stampUtc: null });
    expect(parseBackupName('../etc/passwd')).toBeNull();
    expect(parseBackupName('db_20261018_053000.sql')).toBeNull();
  });

  it('maps object keys under the prefix and ignores sidecars and foreign objects', () => {
    expect(objectKeyFor('db_20261018_010203Z-api.sql.gz', 'db')).toBe('db/db_20261018_010203Z-api.sql.gz.enc');
    expect(nameFromObjectKey('db/db_20261018_010203Z-api.sql.gz.enc', 'db')).toBe('db_20261018_010203Z-api.sql.gz');
    expect(nameFromObjectKey('db/db_20261018_010203Z-api.sql.gz.enc.sha256', 'db')).toBeNull();
    expect(nameFromObjectKey('db/nested/db_20261018_010203Z-api.sql.gz.enc', 'db')).toBeNull();
    expect(nameFromObjectKey('other/db_20261018_010203Z-api.sql.gz.enc', 'db')).toBeNull();
    expect(nameFromObjectKey('db_20261018_010203Z-api.sql.gz.enc', '')).toBe('db_20261018_010203Z-api.sql.gz');
  });
});

describe('schedule', () => {
  it('computes the latest and next UTC slot', () => {
    expect(latestSlot(new Date('2026-10-18T00:30:00Z'), '01:00').toISOString()).toBe('2026-10-17T01:00:00.000Z');
    expect(latestSlot(new Date('2026-10-18T01:00:00Z'), '01:00').toISOString()).toBe('2026-10-18T01:00:00.000Z');
    expect(nextSlot(new Date('2026-10-18T01:00:00Z'), '01:00').toISOString()).toBe('2026-10-19T01:00:00.000Z');
    expect(nextSlot(new Date('2026-12-31T23:30:00Z'), '23:15').toISOString()).toBe('2027-01-01T23:15:00.000Z');
    expect(() => latestSlot(new Date(), '25:00')).toThrow();
  });

  it('is due once per slot', () => {
    const now = new Date('2026-10-18T01:10:00Z');
    expect(isScheduledBackupDue(now, '01:00', null)).toBe(true);
    expect(isScheduledBackupDue(now, '01:00', new Date('2026-10-17T01:05:00Z'))).toBe(true);
    expect(isScheduledBackupDue(now, '01:00', new Date('2026-10-18T01:00:00Z'))).toBe(false);
    expect(isScheduledBackupDue(new Date('2026-10-18T00:50:00Z'), '01:00', new Date('2026-10-17T01:05:00Z'))).toBe(false);
  });

  it('validates the settings input', () => {
    expect(UpdateBackupSettingsSchema.safeParse({ scheduleEnabled: true, scheduleTimeUtc: '03:15', retentionDays: 35 }).success).toBe(true);
    expect(UpdateBackupSettingsSchema.safeParse({ scheduleEnabled: true, scheduleTimeUtc: '3:15', retentionDays: 35 }).success).toBe(false);
    expect(UpdateBackupSettingsSchema.safeParse({ scheduleEnabled: true, scheduleTimeUtc: '03:15', retentionDays: 3 }).success).toBe(false);
    expect(UpdateBackupSettingsSchema.safeParse({ scheduleEnabled: false, scheduleTimeUtc: '03:15', retentionDays: 0 }).success).toBe(true);
  });
});

describe('retention', () => {
  const now = new Date('2026-10-18T02:00:00Z');
  const day = (n: number) => new Date(now.getTime() - n * 24 * 3600 * 1000);
  const entries = [
    { name: 'new', createdAt: day(0.1) },
    { name: 'mid', createdAt: day(10) },
    { name: 'old', createdAt: day(40) },
    { name: 'older', createdAt: day(50) },
  ];

  it('prunes only backups past the retention when the newest is verified', () => {
    const plan = planRetention(entries, new Set(['new']), now, 35);
    expect(plan.skipped).toBeNull();
    expect(plan.delete.sort()).toEqual(['old', 'older']);
    expect(plan.newestVerified).toBe('new');
  });

  it('never deletes when the newest backup is not verified', () => {
    const plan = planRetention(entries, new Set(['mid', 'old']), now, 35);
    expect(plan).toMatchObject({ delete: [], skipped: 'NEWEST_NOT_VERIFIED' });
  });

  it('never deletes the newest verified backup even when it is past the retention', () => {
    const stale = [
      { name: 'a', createdAt: day(60) },
      { name: 'b', createdAt: day(70) },
    ];
    const plan = planRetention(stale, new Set(['a', 'b']), now, 35);
    expect(plan.delete).toEqual(['b']);
    expect(plan.keep).toEqual(['a']);
    expect(newestVerified(stale, new Set(['b']))).toBe('b');
  });

  it('does nothing when turned off or empty', () => {
    expect(planRetention(entries, new Set(['new']), now, 0)).toMatchObject({ delete: [], skipped: 'DISABLED' });
    expect(planRetention([], new Set(), now, 35)).toMatchObject({ delete: [], skipped: 'NO_BACKUPS' });
  });

  it('computes staleness', () => {
    expect(isStale(null, now, 26)).toBe(true);
    expect(isStale(new Date(now.getTime() - 25 * 3600 * 1000), now, 26)).toBe(false);
    expect(isStale(new Date(now.getTime() - 27 * 3600 * 1000), now, 26)).toBe(true);
  });
});

describe('pg_dump environment', () => {
  it('takes DATABASE_URL apart and drops the Prisma schema parameter', () => {
    expect(pgEnvFromUrl('postgresql://app:p%40ss@postgres:5432/app?schema=public&sslmode=require')).toEqual({
      PGHOST: 'postgres',
      PGPORT: '5432',
      PGUSER: 'app',
      PGPASSWORD: 'p@ss',
      PGDATABASE: 'app',
      PGSSLMODE: 'require',
    });
  });
});
