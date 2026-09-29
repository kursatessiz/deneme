import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGzip, gunzipSync } from 'zlib';
import { PrismaClient } from '@platform/database';
import type { BackupOverviewDTO } from '@platform/shared';
import { BACKUP_STORE, LOCAL_BACKUP_LISTER } from '../../src/modules/backups/backup-store';
import { DATABASE_DUMPER } from '../../src/modules/backups/pg-dumper';
import { createEncryptStream } from '../../src/modules/backups/backup-crypto';
import type { BackupRunnerService as RunnerType } from '../../src/modules/backups/backup-runner.service';
import type { BackupsService as BackupsType } from '../../src/modules/backups/backups.service';
import { FAKE_DUMP_SQL, FakeLocalLister, GatedDumper, MemoryBackupStore } from './support/backup-fakes';

/**
 * D2 backups from the super admin panel (docs/YEDEKLER.md) against an
 * in-memory store and a gated fake pg_dump: super admin only, listing
 * off-site and local copies, verification, run-now with the rate limit and
 * the single-run lock, retention after a verified run, guarded delete,
 * presigned download, the health card and the stale alert, all audit
 * logged. Removes its rows in afterAll, so it passes twice in a row.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const OWNER_PHONE = '+905321000002';
const PASSPHRASE = 'e2e-backup-passphrase-0123456789';
const BACKUP_ENTITY_TYPES = ['Backup', 'BackupRun', 'BackupSettings', 'BackupRetention', 'BackupStatus'];

const HOST_NAME = 'db_20261017_233000Z-host.sql.gz';
const OLD_NAME = 'db_20250101_000000Z-host.sql.gz';
const LOCAL_ONLY_NAME = 'db_20261016_023000.sql.gz';

async function artifact(sql: string): Promise<Buffer> {
  const encrypt = await createEncryptStream(PASSPHRASE);
  const out: Buffer[] = [];
  await pipeline(Readable.from([Buffer.from(sql)]), createGzip(), encrypt, async (src: AsyncIterable<Buffer>) => {
    for await (const c of src) out.push(c);
  });
  return Buffer.concat(out);
}

describe('Backups D2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let runner: RunnerType;
  let backups: BackupsType;
  let superAdminToken: string;
  let ownerToken: string;
  const store = new MemoryBackupStore();
  const local = new FakeLocalLister();
  const dumper = new GatedDumper();
  const previousKey = process.env.BACKUP_ENCRYPTION_KEY;

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${superAdminToken}`);
  const overview = async (): Promise<BackupOverviewDTO> => {
    const res = await asAdmin(request(server).get('/admin/backups'));
    expect(res.status).toBe(200);
    return res.body as BackupOverviewDTO;
  };

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { entityType: { in: BACKUP_ENTITY_TYPES } } });
    await prisma.backupRun.deleteMany({});
    await prisma.backupSettings.deleteMany({});
  }

  beforeAll(async () => {
    // Read by ConfigModule when AppModule is loaded, hence the late import.
    process.env.BACKUP_ENCRYPTION_KEY = PASSPHRASE;
    const { AppModule } = await import('../../src/app.module');
    const { BackupRunnerService } = await import('../../src/modules/backups/backup-runner.service');
    const { BackupsService } = await import('../../src/modules/backups/backups.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BACKUP_STORE)
      .useValue(store)
      .overrideProvider(LOCAL_BACKUP_LISTER)
      .useValue(local)
      .overrideProvider(DATABASE_DUMPER)
      .useValue(dumper)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    runner = app.get(BackupRunnerService);
    backups = app.get(BackupsService);
    prisma = new PrismaClient();
    await cleanup();

    const host = await artifact(FAKE_DUMP_SQL);
    store.put(`db/${HOST_NAME}.enc`, host, new Date(Date.now() - 3 * 3600 * 1000));
    store.put(`db/${HOST_NAME}.enc.sha256`, `${createHash('sha256').update(host).digest('hex')}\n`);
    const old = await artifact(FAKE_DUMP_SQL);
    store.put(`db/${OLD_NAME}.enc`, old, new Date('2025-01-01T00:00:00Z'));
    store.put(`db/${OLD_NAME}.enc.sha256`, `${createHash('sha256').update(old).digest('hex')}\n`);
    store.put('db/unrelated.txt', 'not a backup');
    local.files = [
      { name: HOST_NAME, size: 123, modifiedAt: new Date(Date.now() - 3 * 3600 * 1000) },
      { name: LOCAL_ONLY_NAME, size: 456, modifiedAt: new Date(Date.now() - 48 * 3600 * 1000) },
    ];

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    ownerToken = await login(OWNER_PHONE);
  });

  afterAll(async () => {
    dumper.release();
    await runner?.waitForIdle();
    await cleanup();
    await prisma.$disconnect();
    await app.close();
    if (previousKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previousKey;
  });

  describe('access', () => {
    const routes: Array<{ method: 'get' | 'post' | 'put'; path: string }> = [
      { method: 'get', path: '/admin/backups' },
      { method: 'post', path: '/admin/backups/run' },
      { method: 'put', path: '/admin/backups/settings' },
      { method: 'post', path: '/admin/backups/verify' },
      { method: 'post', path: '/admin/backups/download-url' },
      { method: 'post', path: '/admin/backups/delete' },
    ];
    it.each(routes)('refuses the tenant owner on $method $path with 403', async ({ method, path }) => {
      const res = await request(server)[method](path).set('Authorization', `Bearer ${ownerToken}`).send({ name: HOST_NAME, confirmName: HOST_NAME });
      expect(res.status).toBe(403);
    });

    it('refuses an anonymous caller with 401', async () => {
      expect((await request(server).get('/admin/backups')).status).toBe(401);
    });
  });

  describe('overview', () => {
    it('lists off-site and local copies with location, sidecar and summary', async () => {
      const o = await overview();
      expect(o.config).toEqual({
        offsiteConfigured: true,
        localConfigured: true,
        bucket: 'e2e-bucket',
        prefix: 'db',
        endpointHost: 'store.e2e.test',
        downloadUrlTtlSeconds: 300,
      });
      expect(JSON.stringify(o)).not.toContain(PASSPHRASE);
      const byName = new Map(o.entries.map((e) => [e.name, e]));
      expect([...byName.keys()]).toEqual([HOST_NAME, LOCAL_ONLY_NAME, OLD_NAME]);
      expect(byName.get(HOST_NAME)).toMatchObject({ location: 'both', origin: 'host', sha256SidecarPresent: true, localSizeBytes: 123, verifiedAt: null, protected: false });
      expect(byName.get(LOCAL_ONLY_NAME)).toMatchObject({ location: 'local', origin: 'legacy', offsiteKey: null, sha256SidecarPresent: false });
      expect(o.summary.offsiteCount).toBe(2);
      expect(o.summary.localCount).toBe(2);
      expect(o.summary.status.status).toBe('ok');
      expect(o.summary.status.hoursSinceLastSuccess).toBeGreaterThanOrEqual(2.9);
      expect(o.settings).toMatchObject({ scheduleEnabled: true, scheduleTimeUtc: '01:00', retentionDays: 35 });
      expect(o.settings.nextScheduledAt).toMatch(/T01:00:00.000Z$/);
    });

    it('shows the backup status on the system health page', async () => {
      const res = await asAdmin(request(server).get('/admin/health'));
      expect(res.status).toBe(200);
      expect(res.body.backup).toMatchObject({ status: 'ok', offsiteConfigured: true, staleAfterHours: 26 });
    });
  });

  describe('verify, download, settings', () => {
    it('verifies a host backup (sha256 and full test decryption) and audits it', async () => {
      const res = await asAdmin(request(server).post('/admin/backups/verify')).send({ name: HOST_NAME });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: HOST_NAME, ok: true, failure: null, sqlBytes: FAKE_DUMP_SQL.length });
      expect(res.body.sha256).toBe(res.body.sidecarSha256);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'backup.verified', entityId: HOST_NAME } });
      expect(audit?.userId).toBeTruthy();
      const o = await overview();
      expect(o.entries.find((e) => e.name === HOST_NAME)).toMatchObject({ protected: true });
      expect(o.entries.find((e) => e.name === HOST_NAME)?.verifiedAt).toBeTruthy();
    });

    it('reports a corrupted object as failed verification', async () => {
      const key = `db/${OLD_NAME}.enc`;
      const original = store.objects.get(key)!;
      store.put(key, Buffer.concat([original.data.subarray(0, 40), Buffer.alloc(16)]), original.lastModified);
      const res = await asAdmin(request(server).post('/admin/backups/verify')).send({ name: OLD_NAME });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(['DECRYPT_FAILED', 'SHA256_MISMATCH']).toContain(res.body.failure);
      store.put(key, original.data, original.lastModified);
    });

    it('returns a short-lived download URL only for off-site copies', async () => {
      const res = await asAdmin(request(server).post('/admin/backups/download-url')).send({ name: HOST_NAME });
      expect(res.status).toBe(200);
      expect(res.body.url).toContain(`db/${HOST_NAME}.enc`);
      expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
      expect(await prisma.auditLog.count({ where: { action: 'backup.download_url_created', entityId: HOST_NAME } })).toBe(1);

      const localOnly = await asAdmin(request(server).post('/admin/backups/download-url')).send({ name: LOCAL_ONLY_NAME });
      expect(localOnly.status).toBe(409);
      expect(localOnly.body.code).toBe('BACKUP_NOT_DOWNLOADABLE');
      const invalid = await asAdmin(request(server).post('/admin/backups/download-url')).send({ name: '../../etc/passwd' });
      expect(invalid.status).toBe(400);
      const missing = await asAdmin(request(server).post('/admin/backups/download-url')).send({ name: 'db_20200101_000000Z-api.sql.gz' });
      expect(missing.status).toBe(404);
    });

    it('validates and saves the schedule and retention, audit logged', async () => {
      const bad = await asAdmin(request(server).put('/admin/backups/settings')).send({ scheduleEnabled: true, scheduleTimeUtc: '24:00', retentionDays: 35 });
      expect(bad.status).toBe(400);
      const res = await asAdmin(request(server).put('/admin/backups/settings')).send({ scheduleEnabled: false, scheduleTimeUtc: '02:15', retentionDays: 30 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ scheduleEnabled: false, scheduleTimeUtc: '02:15', retentionDays: 30, nextScheduledAt: null });
      expect(await prisma.auditLog.count({ where: { action: 'backup.settings_updated' } })).toBe(1);
      expect(await runner.runScheduledIfDue(new Date())).toMatchObject({ started: false, reason: 'DISABLED' });
    });
  });

  describe('run now', () => {
    let runId: string;

    it('starts a background run, rate-limits run-now and holds the single-run lock', async () => {
      dumper.hold();
      const res = await asAdmin(request(server).post('/admin/backups/run'));
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ status: 'RUNNING', trigger: 'MANUAL' });
      runId = res.body.id;
      expect(await prisma.auditLog.count({ where: { action: 'backup.run_started', entityId: runId, userId: { not: null } } })).toBe(1);

      const again = await asAdmin(request(server).post('/admin/backups/run'));
      expect(again.status).toBe(429);
      expect(again.body.code).toBe('BACKUP_RATE_LIMITED');

      await expect(runner.start('SCHEDULED', null)).rejects.toMatchObject({ code: 'BACKUP_ALREADY_RUNNING' });
      const o = await overview();
      expect(o.runs[0]).toMatchObject({ id: runId, status: 'RUNNING' });
    });

    it('uploads an openssl-compatible artifact with a sidecar, verifies it and prunes past retention', async () => {
      dumper.release();
      await runner.waitForIdle();
      const run = await prisma.backupRun.findUniqueOrThrow({ where: { id: runId } });
      expect(run.status).toBe('SUCCEEDED');
      expect(run.verifiedAt).toBeTruthy();
      expect(run.objectKey).toMatch(/^db\/db_\d{8}_\d{6}Z-api\.sql\.gz\.enc$/);
      const obj = store.objects.get(run.objectKey!)!;
      expect(Number(run.sizeBytes)).toBe(obj.data.length);
      expect((await store.getText(`${run.objectKey}.sha256`))?.trim()).toBe(createHash('sha256').update(obj.data).digest('hex'));

      if (spawnSync('openssl', ['version']).status === 0) {
        // The exact restore command from docs/YEDEKLER.md.
        const gz = execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-pass', 'env:BACKUP_ENCRYPTION_KEY'], {
          input: obj.data,
          env: { ...process.env, BACKUP_ENCRYPTION_KEY: PASSPHRASE },
        });
        expect(gunzipSync(gz).toString()).toBe(FAKE_DUMP_SQL);
      }

      // Retention 30 days: the 2025 backup goes, the newest verified stays.
      expect(store.objects.has(`db/${OLD_NAME}.enc`)).toBe(false);
      expect(store.objects.has(`db/${OLD_NAME}.enc.sha256`)).toBe(false);
      expect(store.objects.has(`db/${HOST_NAME}.enc`)).toBe(true);
      const pruned = await prisma.auditLog.findFirst({ where: { action: 'backup.pruned' } });
      expect((pruned?.metadata as { deleted: string[] }).deleted).toEqual([OLD_NAME]);
      expect(await prisma.auditLog.count({ where: { action: 'backup.run_succeeded', entityId: runId } })).toBe(1);

      const o = await overview();
      const apiEntry = o.entries.find((e) => e.origin === 'api');
      expect(apiEntry).toMatchObject({ location: 'offsite', protected: true, sha256SidecarPresent: true });
      expect(o.runs[0]).toMatchObject({ id: runId, status: 'SUCCEEDED' });
    });

    it('frees the lock after the run', async () => {
      const settings = await prisma.backupSettings.findUniqueOrThrow({ where: { id: 'platform' } });
      expect(settings.lockRunId).toBeNull();
    });
  });

  describe('delete', () => {
    it('requires the typed name, refuses the newest verified backup and the last copy, audits a delete', async () => {
      const o = await overview();
      const newest = o.entries.find((e) => e.protected)!;

      const mismatch = await asAdmin(request(server).post('/admin/backups/delete')).send({ name: HOST_NAME, confirmName: 'yes' });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.code).toBe('BACKUP_CONFIRM_MISMATCH');

      const protectedRes = await asAdmin(request(server).post('/admin/backups/delete')).send({ name: newest.name, confirmName: newest.name });
      expect(protectedRes.status).toBe(409);
      expect(protectedRes.body.code).toBe('BACKUP_NEWEST_VERIFIED_PROTECTED');

      const ok = await asAdmin(request(server).post('/admin/backups/delete')).send({ name: HOST_NAME, confirmName: HOST_NAME });
      expect(ok.status).toBe(204);
      expect(store.objects.has(`db/${HOST_NAME}.enc`)).toBe(false);
      expect(store.objects.has(`db/${HOST_NAME}.enc.sha256`)).toBe(false);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'backup.deleted', entityId: HOST_NAME } });
      expect(audit?.userId).toBeTruthy();

      const last = await asAdmin(request(server).post('/admin/backups/delete')).send({ name: newest.name, confirmName: newest.name });
      expect(last.status).toBe(409);
      expect(last.body.code).toBe('BACKUP_LAST_COPY_PROTECTED');
    });
  });

  describe('stale alert', () => {
    it('emails super admins once a day when no backup succeeded within the threshold', async () => {
      const future = new Date(Date.now() + 5 * 24 * 3600 * 1000);
      const first = await backups.checkStaleIfDue(future, true);
      expect(first).toEqual({ status: 'stale', alerted: true });
      const second = await backups.checkStaleIfDue(new Date(future.getTime() + 2 * 3600 * 1000), true);
      expect(second).toEqual({ status: 'stale', alerted: false });
      expect(await prisma.auditLog.count({ where: { action: 'backup.stale_alert_sent' } })).toBe(1);
    });
  });
});
