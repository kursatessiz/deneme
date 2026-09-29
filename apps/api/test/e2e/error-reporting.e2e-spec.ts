import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@platform/database';
import { ERROR_LIMITS, errorCodeFromId } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { ErrorCaptureService } from '../../src/modules/error-reporting/error-capture.service';
import { TelemetryRateLimiter, TELEMETRY_MAX_PER_SESSION } from '../../src/modules/error-reporting/telemetry-rate-limit.service';

/**
 * H1 error capture and reporting end to end (docs/HATA_RAPORLAMA.md): API
 * 5xx capture with the request id and PII masked, 4xx ignored, client
 * ingest (size and rate limits, studio spoofing ignored), tenant isolation
 * of the owner view, permissions, super admin actions, exactly one alert
 * per new group, regression reopen and the retention purge.
 *
 * Every group this suite creates carries RUN (random letters) in its
 * fingerprint; afterAll removes them, so the suite passes twice in a row.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const TRAINER_PHONE = '+905321000004';
const FLOW_OWNER_PHONE = '+905321000022';

function letters(n: number): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < n; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}
const RUN = `h${letters(9)}`;
const tag = (name: string) => `${RUN}${name}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Error reporting H1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let capture: ErrorCaptureService;
  let limiter: TelemetryRateLimiter;

  let ZEN: string;
  let FLOW: string;
  let superAdminToken: string;
  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let flowOwnerToken: string;
  let superAdminsWithEmail: number;

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const groupOf = (name: string) => prisma.errorGroup.findFirst({ where: { fingerprint: { contains: tag(name) } } });
  const clientEvent = (name: string, extra: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    source: 'web',
    severity: 'error',
    release: 'sha-e2e',
    environment: 'test',
    route: '/ayarlar/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
    type: 'TypeError',
    message: `Client failure ${tag(name)} for ada@example.com`,
    stack: `TypeError: x\n    at onClick (https://app.example.com/_next/static/chunks/app/page.js?v=1:1:200)`,
    breadcrumbs: [{ type: 'click', message: 'button Kaydet', at: new Date().toISOString(), data: { token: 'abc' } }],
    timestamp: new Date().toISOString(),
    ...extra,
  });
  const ingest = (body: unknown, token?: string, studioId?: string) => {
    const req = request(server).post('/telemetry/errors');
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (studioId) req.set('x-studio-id', studioId);
    return req.send(body as object);
  };

  async function cleanup() {
    const groups = await prisma.errorGroup.findMany({ where: { fingerprint: { contains: RUN } }, select: { id: true } });
    const ids = groups.map((g) => g.id);
    await prisma.auditLog.deleteMany({ where: { entityType: 'ErrorGroup', entityId: { in: ids } } });
    await prisma.errorGroup.deleteMany({ where: { id: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { action: 'error_reporting.digest_sent' } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    capture = app.get(ErrorCaptureService);
    limiter = app.get(TelemetryRateLimiter);

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    await cleanup();

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    ownerToken = await login(OWNER_PHONE);
    receptionToken = await login(RECEPTION_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
    superAdminsWithEmail = await prisma.user.count({ where: { isSuperAdmin: true, isActive: true, email: { not: null } } });
  });

  afterAll(async () => {
    await capture.flush();
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(() => limiter.reset());

  describe('correlation id', () => {
    it('echoes a valid x-request-id and replaces an invalid one', async () => {
      const id = randomUUID();
      const ok = await request(server).get('/health').set('x-request-id', id);
      expect(ok.headers['x-request-id']).toBe(id);
      const bad = await request(server).get('/health').set('x-request-id', 'bad id');
      expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      const none = await request(server).get('/health');
      expect(none.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('API capture', () => {
    it('records an unexpected 5xx with the request id, PII masked, response shape unchanged', async () => {
      const requestId = randomUUID();
      const res = await request(server).get(`/telemetry/test/boom/${tag('boom')}`).set('x-request-id', requestId);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
      expect(res.headers['x-request-id']).toBe(requestId);
      const code = res.headers['x-error-code'];
      expect(code).toMatch(/^[0-9A-F]{8}$/);
      await capture.flush();

      const group = await groupOf('boom');
      expect(group).not.toBeNull();
      expect(group!.source).toBe('api');
      expect(group!.status).toBe('OPEN');
      expect(group!.count).toBe(1);
      const event = await prisma.errorEvent.findFirstOrThrow({ where: { groupId: group!.id } });
      expect(event.requestId).toBe(requestId);
      expect(event.code).toBe(code);
      expect(errorCodeFromId(event.id)).toBe(code);
      expect(event.statusCode).toBe(500);
      expect(event.route).toBe('GET /telemetry/test/boom/:tag');
      for (const text of [event.message, event.stack ?? '', group!.title]) {
        expect(text).not.toContain('ada.lovelace@example.com');
        expect(text).not.toContain('5321000002');
        expect(text).not.toContain('hunter2');
      }
      expect(event.message).toContain('[email]');
      expect(event.message).toContain('[phone]');
    });

    it('does not record a 4xx', async () => {
      const res = await request(server).get(`/telemetry/test/bad-request/${tag('fourxx')}`);
      expect(res.status).toBe(400);
      expect(res.headers['x-error-code']).toBeUndefined();
      await capture.flush();
      expect(await groupOf('fourxx')).toBeNull();
      expect(await prisma.errorEvent.count({ where: { message: { contains: tag('fourxx') } } })).toBe(0);
    });

    it('sends exactly one alert per new group, however often it recurs', async () => {
      await request(server).get(`/telemetry/test/boom/${tag('alert')}`).expect(500);
      await capture.flush();
      await sleep(1100); // past the one-second dedupe window
      await request(server).get(`/telemetry/test/boom/${tag('alert')}`).expect(500);
      await capture.flush();
      await sleep(1100);
      await request(server).get(`/telemetry/test/boom/${tag('alert')}`).expect(500);
      await capture.flush();

      const group = (await groupOf('alert'))!;
      expect(group.count).toBe(3);
      const alerts = await prisma.auditLog.findMany({ where: { action: 'error_group.alert_sent', entityId: group.id } });
      expect(alerts).toHaveLength(1);
      expect((alerts[0].metadata as { kind: string }).kind).toBe('NEW');
      const emails = await prisma.notificationLog.count({ where: { type: 'ERROR_NEW_GROUP', channel: 'EMAIL', content: { contains: tag('alert') } } });
      expect(emails).toBe(superAdminsWithEmail);
    });

    it('deduplicates an identical fingerprint within one second', async () => {
      const [a, b] = await Promise.all([
        request(server).get(`/telemetry/test/boom/${tag('dedupe')}`),
        request(server).get(`/telemetry/test/boom/${tag('dedupe')}`),
      ]);
      expect([a.status, b.status]).toEqual([500, 500]);
      await capture.flush();
      expect((await groupOf('dedupe'))!.count).toBe(1);
    });

    it('alerts on a critical flow with the critical template', async () => {
      await request(server).get(`/telemetry/test/payments/boom/${tag('pay')}`).expect(500);
      await capture.flush();
      const group = (await groupOf('pay'))!;
      expect(group.critical).toBe(true);
      const alert = await prisma.auditLog.findFirstOrThrow({ where: { action: 'error_group.alert_sent', entityId: group.id } });
      expect((alert.metadata as { kind: string }).kind).toBe('CRITICAL');
    });

    it('attributes a studio-scoped 5xx to the tenant', async () => {
      const res = await request(server)
        .get(`/telemetry/test/studios/${ZEN}/boom/${tag('studio')}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(500);
      await capture.flush();
      const group = (await groupOf('studio'))!;
      expect(group.affectedStudioCount).toBe(1);
      expect(group.affectedUserCount).toBe(1);
      const event = await prisma.errorEvent.findFirstOrThrow({ where: { groupId: group.id } });
      expect(event.studioId).toBe(ZEN);
      expect(event.userIdHash).toMatch(/^[0-9a-f]{64}$/);
      const owner = await prisma.user.findUniqueOrThrow({ where: { phone: OWNER_PHONE } });
      expect(event.userIdHash).not.toContain(owner.id);
    });
  });

  describe('client ingest', () => {
    it('accepts an anonymous batch, scrubs it and ignores a body studioId', async () => {
      const res = await ingest({ events: [clientEvent('anon', { studioId: ZEN, userIdHash: 'spoofed' })] });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ accepted: 1 });
      await capture.flush();
      const group = (await groupOf('anon'))!;
      expect(group.source).toBe('web');
      const event = await prisma.errorEvent.findFirstOrThrow({ where: { groupId: group.id } });
      expect(event.studioId).toBeNull();
      expect(event.userIdHash).toBeNull();
      expect(event.message).not.toContain('ada@example.com');
      expect(event.route).toBe('/ayarlar/:id');
      expect(JSON.stringify(event.breadcrumbs)).not.toContain('abc');
    });

    it('takes the studio only from the authenticated membership', async () => {
      await ingest({ events: [clientEvent('own')] }, ownerToken, ZEN).expect(202);
      // Zen's owner is not a member of Flow: the header is not trusted.
      await ingest({ events: [clientEvent('spoof', { studioId: FLOW })] }, ownerToken, FLOW).expect(202);
      await capture.flush();
      const own = await prisma.errorEvent.findFirstOrThrow({ where: { group: { fingerprint: { contains: tag('own') } } } });
      expect(own.studioId).toBe(ZEN);
      expect(own.userIdHash).toMatch(/^[0-9a-f]{64}$/);
      const spoof = await prisma.errorEvent.findFirstOrThrow({ where: { group: { fingerprint: { contains: tag('spoof') } } } });
      expect(spoof.studioId).toBeNull();
    });

    it('rejects invalid batches and server-only sources', async () => {
      await ingest({ events: [] }).expect(400);
      await ingest({ events: [clientEvent('api', { source: 'api' })] }).expect(400);
      const tooMany = Array.from({ length: ERROR_LIMITS.batchItems + 1 }, () => clientEvent('many'));
      await ingest({ events: tooMany }).expect(400);
    });

    it('enforces the body size limit', async () => {
      const big = { events: [clientEvent('big', { message: 'x'.repeat(900) })], padding: 'y'.repeat(ERROR_LIMITS.batchBytes) };
      const res = await ingest(big);
      expect(res.status).toBe(413);
    });

    it('rate limits per session', async () => {
      const sessionId = randomUUID();
      const statuses: number[] = [];
      for (let i = 0; i <= TELEMETRY_MAX_PER_SESSION; i++) {
        const res = await ingest({ events: [clientEvent(`rl${letters(3)}`, { sessionId, message: `rate ${RUN} ${i}` })] });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, TELEMETRY_MAX_PER_SESSION).every((s) => s === 202)).toBe(true);
      expect(statuses[TELEMETRY_MAX_PER_SESSION]).toBe(429);
      // Another session from the same IP is still served.
      await ingest({ events: [clientEvent('other', { sessionId: randomUUID() })] }).expect(202);
      await capture.flush();
    });
  });

  describe('tenant owner view', () => {
    it("lists only the studio's own groups without stack traces", async () => {
      const res = await request(server).get(`/studios/${ZEN}/errors`).set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
      const studioGroup = (await groupOf('studio'))!;
      const ownGroup = (await groupOf('own'))!;
      const anonGroup = (await groupOf('anon'))!;
      const ids = (res.body as Array<{ id: string }>).map((g) => g.id);
      expect(ids).toEqual(expect.arrayContaining([studioGroup.id, ownGroup.id]));
      expect(ids).not.toContain(anonGroup.id);
      const api = res.body.find((g: { id: string }) => g.id === studioGroup.id);
      expect(api.safeMessage).toBeNull();
      expect(api.lastCode).toMatch(/^[0-9A-F]{8}$/);
      const web = res.body.find((g: { id: string }) => g.id === ownGroup.id);
      expect(web.safeMessage).toContain('[email]');
      expect(JSON.stringify(res.body)).not.toMatch(/stack|fingerprint|userIdHash/);
    });

    it("never shows another tenant's errors", async () => {
      const res = await request(server).get(`/studios/${FLOW}/errors`).set('Authorization', `Bearer ${flowOwnerToken}`);
      expect(res.status).toBe(200);
      const zenGroups = [(await groupOf('studio'))!.id, (await groupOf('own'))!.id];
      for (const g of res.body as Array<{ id: string }>) expect(zenGroups).not.toContain(g.id);
      await request(server).get(`/studios/${ZEN}/errors`).set('Authorization', `Bearer ${flowOwnerToken}`).expect(403);
    });

    it('denies reception and trainers without errors.view', async () => {
      await request(server).get(`/studios/${ZEN}/errors`).set('Authorization', `Bearer ${receptionToken}`).expect(403);
      await request(server).get(`/studios/${ZEN}/errors`).set('Authorization', `Bearer ${trainerToken}`).expect(403);
    });

    it('the migration granted errors.view to existing owner role templates', async () => {
      const owners = await prisma.roleTemplate.findMany({ where: { isOwner: true }, include: { permissions: true } });
      expect(owners.length).toBeGreaterThan(0);
      for (const role of owners) expect(role.permissions.map((p) => p.permissionKey)).toContain('errors.view');
    });
  });

  describe('super admin', () => {
    const admin = () => ({
      get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${superAdminToken}`),
      post: (url: string, body: object = {}) => request(server).post(url).set('Authorization', `Bearer ${superAdminToken}`).send(body),
      patch: (url: string, body: object) => request(server).patch(url).set('Authorization', `Bearer ${superAdminToken}`).send(body),
    });

    it('is closed to tenant owners', async () => {
      await request(server).get('/admin/errors').set('Authorization', `Bearer ${ownerToken}`).expect(403);
      const group = (await groupOf('boom'))!;
      await request(server).post(`/admin/errors/${group.id}/ignore`).set('Authorization', `Bearer ${ownerToken}`).expect(403);
    });

    it('lists with filters and finds a group by its error code', async () => {
      const group = (await groupOf('boom'))!;
      const bySource = await admin().get('/admin/errors?source=api&status=OPEN');
      expect(bySource.status).toBe(200);
      expect(bySource.body.items.every((g: { source: string; status: string }) => g.source === 'api' && g.status === 'OPEN')).toBe(true);
      const byCode = await admin().get(`/admin/errors?q=${group.lastCode!.toLowerCase()}`);
      expect(byCode.body.items.map((g: { id: string }) => g.id)).toContain(group.id);
      const byStudio = await admin().get(`/admin/errors?studioId=${ZEN}`);
      expect(byStudio.body.items.map((g: { id: string }) => g.id)).toContain((await groupOf('studio'))!.id);
      expect(byStudio.body.items.map((g: { id: string }) => g.id)).not.toContain(group.id);
      const byRelease = await admin().get('/admin/errors?release=sha-e2e');
      expect(byRelease.body.items.map((g: { id: string }) => g.id)).toContain((await groupOf('anon'))!.id);
    });

    it('shows the detail with stack, breadcrumbs, releases and studios', async () => {
      const group = (await groupOf('own'))!;
      const res = await admin().get(`/admin/errors/${group.id}`);
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].stack).toContain('onClick');
      expect(res.body.events[0].breadcrumbs[0].data.token).toBe('[redacted]');
      expect(res.body.releases).toEqual([expect.objectContaining({ release: 'sha-e2e', count: 1 })]);
      expect(res.body.studios).toEqual([expect.objectContaining({ studioId: ZEN, count: 1 })]);
      await admin().get('/admin/errors/not-a-uuid').expect(404);
    });

    it('ignores, reopens and annotates with an audit trail', async () => {
      const group = (await groupOf('boom'))!;
      expect((await admin().post(`/admin/errors/${group.id}/ignore`)).body.status).toBe('IGNORED');
      expect((await admin().post(`/admin/errors/${group.id}/reopen`)).body.status).toBe('OPEN');
      await admin().patch(`/admin/errors/${group.id}/note`, { note: 'Investigating' }).expect(200);
      expect((await prisma.errorGroup.findUniqueOrThrow({ where: { id: group.id } })).note).toBe('Investigating');
      const actions = (await prisma.auditLog.findMany({ where: { entityType: 'ErrorGroup', entityId: group.id } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['error_group.ignore', 'error_group.reopen', 'error_group.note']));
    });

    it('reopens a resolved group in another release and alerts once', async () => {
      const group = (await groupOf('boom'))!;
      await admin().post(`/admin/errors/${group.id}/resolve`, { release: 'dev' }).expect(200);
      // Same release as the fix: stays resolved.
      await request(server).get(`/telemetry/test/boom/${tag('boom')}`).expect(500);
      await capture.flush();
      expect((await prisma.errorGroup.findUniqueOrThrow({ where: { id: group.id } })).status).toBe('RESOLVED');

      await admin().post(`/admin/errors/${group.id}/resolve`, { release: 'sha-old' }).expect(200);
      await sleep(1100);
      await request(server).get(`/telemetry/test/boom/${tag('boom')}`).expect(500);
      await capture.flush();
      const reopened = await prisma.errorGroup.findUniqueOrThrow({ where: { id: group.id } });
      expect(reopened.status).toBe('OPEN');
      expect(await prisma.auditLog.count({ where: { action: 'error_group.regressed', entityId: group.id } })).toBe(1);
      const alerts = await prisma.auditLog.findMany({ where: { action: 'error_group.alert_sent', entityId: group.id }, orderBy: { createdAt: 'asc' } });
      expect(alerts.map((a) => (a.metadata as { kind: string }).kind)).toEqual(['NEW', 'REGRESSION']);
      expect(await prisma.notificationLog.count({ where: { type: 'ERROR_REGRESSION', content: { contains: tag('boom') } } })).toBe(superAdminsWithEmail);
    });
  });

  describe('retention and digest', () => {
    it('purges events older than 30 days and sends the daily digest once', async () => {
      const group = (await groupOf('anon'))!;
      const oldId = randomUUID();
      await prisma.errorEvent.create({
        data: {
          id: oldId,
          groupId: group.id,
          code: errorCodeFromId(oldId),
          source: 'web',
          severity: 'error',
          release: 'sha-e2e',
          environment: 'test',
          type: 'TypeError',
          message: 'old',
          occurredAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        },
      });
      const run = await request(server).post('/admin/scheduler/run').set('Authorization', `Bearer ${superAdminToken}`).send({});
      expect(run.status).toBe(201);
      expect(run.body.errorReporting.purged).toBeGreaterThanOrEqual(1);
      expect(run.body.errorReporting.digestSent).toBe(true);
      expect(await prisma.errorEvent.findUnique({ where: { id: oldId } })).toBeNull();
      // Recent events of the same group stay.
      expect(await prisma.errorEvent.count({ where: { groupId: group.id } })).toBe(1);

      const again = await request(server).post('/admin/scheduler/run').set('Authorization', `Bearer ${superAdminToken}`).send({});
      expect(again.body.errorReporting.digestSent).toBe(false);
      expect(await prisma.auditLog.count({ where: { action: 'error_reporting.digest_sent' } })).toBe(1);
    });
  });
});
