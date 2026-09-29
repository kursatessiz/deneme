import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@platform/database';
import { SOURCEMAP_LIMITS } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { configureBodyParsers } from '../../src/common/body-parsers';
import { ErrorCaptureService } from '../../src/modules/error-reporting/error-capture.service';
import { SourcemapStoreService } from '../../src/modules/error-reporting/sourcemap-store.service';
import { TelemetryRateLimiter } from '../../src/modules/error-reporting/telemetry-rate-limit.service';

/**
 * H2 source maps and symbolication end to end (docs/HATA_RAPORLAMA.md):
 * the token-protected upload endpoint (token, size limits, validation),
 * symbolication of a minified client event for a known release against an
 * unknown one, the resolved stack in the admin view, and the retention
 * purge. Every group carries RUN in its fingerprint; afterAll removes them
 * and the temporary map directory.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const TOKEN = 'e2e-sourcemap-token-e2e-sourcemap-token-1234';

function letters(n: number): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < n; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}
const RUN = `h${letters(9)}`;
const RELEASE = `sha-${RUN}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `function a(){throw new Error("x")}`: column 15 (0-based) maps to src/app.ts line 2, column 2. */
const MAP = JSON.stringify({ version: 3, sources: ['webpack://_N_E/./src/app.ts'], names: [], mappings: 'AAAA,cACE' });
const BUNDLE_PATH = '_next/static/chunks/e2e.js';

describe('Error source maps H2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let capture: ErrorCaptureService;
  let limiter: TelemetryRateLimiter;
  let store: SourcemapStoreService;
  let dir: string;
  let superAdminToken: string;

  const upload = (body: unknown, token: string | null = TOKEN) => {
    const req = request(server).post('/admin/errors/sourcemaps');
    if (token) req.set('x-sourcemap-token', token);
    return req.send(body as object);
  };
  const validUpload = (overrides: Record<string, unknown> = {}) => ({ release: RELEASE, platform: 'web', path: BUNDLE_PATH, map: MAP, ...overrides });
  const clientEvent = (name: string, release: string) => ({
    eventId: randomUUID(),
    source: 'web',
    severity: 'error',
    release,
    environment: 'test',
    route: '/ayarlar',
    type: 'TypeError',
    message: `Minified failure ${RUN}${name}`,
    stack: `TypeError: x\n    at a (https://app.example.com/${BUNDLE_PATH}?dpl=1:1:16)\n    at https://app.example.com/vendor.js:1:5`,
    timestamp: new Date().toISOString(),
  });
  const cleanup = async () => {
    const groups = await prisma.errorGroup.findMany({ where: { fingerprint: { contains: RUN } }, select: { id: true } });
    const ids = groups.map((g) => g.id);
    await prisma.auditLog.deleteMany({ where: { entityType: 'ErrorGroup', entityId: { in: ids } } });
    await prisma.errorGroup.deleteMany({ where: { id: { in: ids } } });
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'e2e-sourcemaps-'));
    process.env.SOURCEMAP_UPLOAD_TOKEN = TOKEN;
    process.env.SOURCEMAP_DIR = dir;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Large bodies and the token gate come from configureBodyParsers, as in src/main.ts.
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureBodyParsers(app as NestExpressApplication);
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    capture = app.get(ErrorCaptureService);
    limiter = app.get(TelemetryRateLimiter);
    store = app.get(SourcemapStoreService);
    await cleanup();
    const login = await request(server).post('/auth/login').send({ emailOrPhone: SUPER_ADMIN_PHONE, password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    superAdminToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    await capture.flush();
    await cleanup();
    await prisma.$disconnect();
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.SOURCEMAP_UPLOAD_TOKEN;
    delete process.env.SOURCEMAP_DIR;
  });

  beforeEach(() => limiter.reset());

  describe('POST /admin/errors/sourcemaps', () => {
    it('refuses a request without the token or with a wrong one', async () => {
      expect((await upload(validUpload(), null)).status).toBe(403);
      expect((await upload(validUpload(), 'wrong-token-wrong-token-wrong-token-1')).status).toBe(403);
      expect((await upload(validUpload(), TOKEN.slice(0, -1))).status).toBe(403);
    });

    it('is not opened by a super admin session or a user token alone', async () => {
      const res = await request(server).post('/admin/errors/sourcemaps').set('Authorization', `Bearer ${superAdminToken}`).send(validUpload());
      expect(res.status).toBe(403);
    });

    it('stores a map with the token (x-sourcemap-token or bearer) and reports a replace', async () => {
      const first = await upload(validUpload());
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ release: RELEASE, platform: 'web', path: BUNDLE_PATH, replaced: false });
      const again = await request(server).post('/admin/errors/sourcemaps').set('Authorization', `Bearer ${TOKEN}`).send(validUpload({ map: JSON.parse(MAP) }));
      expect(again.status).toBe(201);
      expect(again.body.replaced).toBe(true);
    });

    it('rejects invalid input', async () => {
      expect((await upload(validUpload({ release: '../evil' }))).status).toBe(400);
      expect((await upload(validUpload({ platform: 'desktop' }))).status).toBe(400);
      expect((await upload(validUpload({ path: '../../etc/passwd' }))).status).toBe(400);
      expect((await upload(validUpload({ map: '{"version":3}' }))).status).toBe(400);
      expect((await upload(validUpload({ map: 'not json' }))).status).toBe(400);
      expect((await upload({ ...validUpload(), extra: 'x' })).status).toBe(400);
    });

    it('enforces the size limits (one map 10 MB, one request 24 MB)', async () => {
      const bigMap = JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA', pad: 'x'.repeat(SOURCEMAP_LIMITS.fileBytes) });
      expect((await upload(validUpload({ path: 'big.js', map: bigMap }))).status).toBe(413);
      const huge = await upload(validUpload({ path: 'huge.js', map: 'x'.repeat(SOURCEMAP_LIMITS.bodyBytes + 1024) }));
      expect(huge.status).toBe(413);
      // A map just under the limit is accepted.
      const ok = JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA', pad: 'x'.repeat(SOURCEMAP_LIMITS.fileBytes - 200) });
      expect((await upload(validUpload({ path: 'ok.js', map: ok }))).status).toBe(201);
    });
  });

  describe('symbolication', () => {
    it('resolves the stack of an event of a known release and keeps the raw stack', async () => {
      const event = clientEvent('known', RELEASE);
      const res = await request(server).post('/telemetry/errors').send({ events: [event] });
      expect(res.status).toBe(202);
      await capture.flush();
      const stored = await prisma.errorEvent.findUniqueOrThrow({ where: { id: event.eventId } });
      expect(stored.stack).toContain('_next/static/chunks/e2e.js');
      expect(stored.symbolicatedStack).toContain('at a (src/app.ts:2:3)');
      expect(stored.symbolicatedStack).toContain('at https://app.example.com/vendor.js:1:5');
      const group = await prisma.errorGroup.findUniqueOrThrow({ where: { id: stored.groupId } });
      expect(group.topFrame).toContain('src/app.ts');

      const detail = await request(server).get(`/admin/errors/${stored.groupId}`).set('Authorization', `Bearer ${superAdminToken}`);
      expect(detail.status).toBe(200);
      const item = (detail.body.events as Array<{ id: string; stack: string; symbolicatedStack: string | null }>).find((e) => e.id === event.eventId);
      expect(item?.symbolicatedStack).toContain('src/app.ts:2:3');
      expect(item?.stack).toContain('e2e.js');
    });

    it('leaves the stack unresolved for an unknown release', async () => {
      const event = clientEvent('unknown', `sha-unknown${RUN}`);
      const res = await request(server).post('/telemetry/errors').send({ events: [event] });
      expect(res.status).toBe(202);
      await capture.flush();
      const stored = await prisma.errorEvent.findUniqueOrThrow({ where: { id: event.eventId } });
      expect(stored.symbolicatedStack).toBeNull();
      expect(stored.stack).toContain('e2e.js');
    });

    it('does not resolve a web event with a map uploaded for mobile', async () => {
      const mobileRelease = `9.9.${RUN}`;
      expect((await upload(validUpload({ release: mobileRelease, platform: 'mobile', path: 'index.android.bundle' }))).status).toBe(201);
      const event = { ...clientEvent('platform', mobileRelease), stack: 'TypeError: x\n    at a (index.android.bundle:1:16)' };
      await request(server).post('/telemetry/errors').send({ events: [event] });
      await capture.flush();
      expect((await prisma.errorEvent.findUniqueOrThrow({ where: { id: event.eventId } })).symbolicatedStack).toBeNull();

      const mobile = { ...clientEvent('mobile', mobileRelease), source: 'mobile', stack: 'TypeError: x\n    at a (address at /data/user/0/app/index.android.bundle:1:16)' };
      await request(server).post('/telemetry/errors').send({ events: [mobile] });
      await capture.flush();
      expect((await prisma.errorEvent.findUniqueOrThrow({ where: { id: mobile.eventId } })).symbolicatedStack).toContain('src/app.ts:2:3');
    });
  });

  describe('retention', () => {
    it('purges maps older than 30 days and keeps recent ones', async () => {
      const old = `old${RUN}`;
      expect((await upload(validUpload({ release: old, path: 'a.js' }))).status).toBe(201);
      const file = (await fs.readdir(join(dir, 'web', old)))[0];
      const past = new Date(Date.now() - (SOURCEMAP_LIMITS.retentionDays + 1) * 24 * 3600 * 1000);
      await fs.utimes(join(dir, 'web', old, file), past, past);

      expect(await store.purgeExpired(new Date())).toBeGreaterThanOrEqual(1);
      expect(await store.find('web', old, ['a.js'])).toBeNull();
      expect(await store.find('web', RELEASE, [BUNDLE_PATH])).not.toBeNull();
      await sleep(0);
    });
  });
});
