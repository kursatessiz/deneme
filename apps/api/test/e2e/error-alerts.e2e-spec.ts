import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { configureBodyParsers } from '../../src/common/body-parsers';
import { AlertHttpClient } from '../../src/modules/error-reporting/alert-sinks/alert-http.client';
import type { AlertHttpRequest } from '../../src/modules/error-reporting/alert-sinks/alert-http.client';
import { AlertSinkDispatcher } from '../../src/modules/error-reporting/alert-sinks/alert-sink-dispatcher.service';
import { ErrorCaptureService } from '../../src/modules/error-reporting/error-capture.service';
import { ErrorSpikeService } from '../../src/modules/error-reporting/error-spike.service';
import { SourcemapStoreService } from '../../src/modules/error-reporting/sourcemap-store.service';
import { TelemetryRateLimiter } from '../../src/modules/error-reporting/telemetry-rate-limit.service';
import { verifySignatureHeader } from '../../src/modules/webhooks/webhook-signature';

/**
 * H3 error reporting completion end to end (docs/HATA_RAPORLAMA.md): spike
 * alerts (once within the cooldown, again after it), regression alerts, group
 * merging with fingerprint aliases, the signed webhook and Slack sinks
 * against a stub HTTP client (signature, retry on 5xx), the opt-in owner
 * e-mail (once per group per day), the feedback endpoint (scrubbing, rate
 * limit, ownership) and source context lines. Every group carries RUN in its
 * fingerprint; afterAll removes them and the temporary map directory.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const FLOW_OWNER_PHONE = '+905321000022';
const WEBHOOK_URL = 'https://93.184.216.34/e2e-errors';
const WEBHOOK_SECRET = 'e2e-alert-signing-secret-value';
const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/e2ealerts';

function letters(n: number): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < n; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}
const RUN = `h${letters(9)}`;
const tag = (name: string) => `${RUN}${name}`;
const RELEASE = `sha-${RUN}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MINUTE = 60_000;

/** Replaces AlertHttpClient: records requests and answers with queued statuses (200 when the queue is empty). */
class StubAlertHttp {
  calls: AlertHttpRequest[] = [];
  statuses: number[] = [];
  async post(input: AlertHttpRequest): Promise<{ status: number }> {
    this.calls.push(input);
    return { status: this.statuses.shift() ?? 200 };
  }
  reset(): void {
    this.calls = [];
    this.statuses = [];
  }
}

/** `function a(){throw new Error("x")}`: column 15 (0-based) maps to src/app.ts line 2, column 2. */
const APP_SOURCE = 'export function fail() {\n  throw new Error("boom");\n}';
const MAP = JSON.stringify({ version: 3, sources: ['webpack://_N_E/./src/app.ts'], sourcesContent: [APP_SOURCE], names: [], mappings: 'AAAA,cACE' });
const BUNDLE_PATH = `_next/static/chunks/${RUN}.js`;

describe('Error reporting H3 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let capture: ErrorCaptureService;
  let limiter: TelemetryRateLimiter;
  let spikes: ErrorSpikeService;
  let dispatcher: AlertSinkDispatcher;
  let store: SourcemapStoreService;
  let http: StubAlertHttp;
  let mapDir: string;

  let ZEN: string;
  let FLOW: string;
  let superAdminToken: string;
  let ownerToken: string;
  let trainerToken: string;
  let flowOwnerToken: string;
  let superAdminsWithEmail: number;
  let ownerOriginalEmail: string | null = null;
  const startedAt = new Date();

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const clientEvent = (name: string, extra: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    source: 'web',
    severity: 'error',
    release: RELEASE,
    environment: 'test',
    route: '/ayarlar',
    type: 'TypeError',
    message: `Client failure ${tag(name)} for ada@example.com`,
    stack: 'TypeError: x\n    at onClick (https://app.example.com/_next/static/chunks/app/page.js?v=1:1:200)',
    timestamp: new Date().toISOString(),
    ...extra,
  });
  const ingest = (body: unknown, token?: string, studioId?: string) => {
    const req = request(server).post('/telemetry/errors');
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (studioId) req.set('x-studio-id', studioId);
    return req.send(body as object);
  };
  /** Ingests one event and returns its group (fresh from the database). */
  async function seedGroup(name: string, extra: Record<string, unknown> = {}, token?: string, studioId?: string) {
    const event = clientEvent(name, extra);
    await ingest({ events: [event] }, token, studioId).expect(202);
    await capture.flush();
    const group = await groupOf(name);
    expect(group).not.toBeNull();
    return { group: group!, eventId: event.eventId as string };
  }
  const groupOf = (name: string) => prisma.errorGroup.findFirst({ where: { fingerprint: { contains: tag(name) } } });
  const setBuckets = async (groupId: string, entries: Array<[Date, number]>) => {
    for (const [bucketStart, count] of entries) {
      await prisma.errorGroupBucket.upsert({ where: { groupId_bucketStart: { groupId, bucketStart } }, create: { groupId, bucketStart, count }, update: { count } });
    }
  };
  /** 96 buckets of `perBucket` events ending right before `windowStart`, and an old first-seen date so the whole baseline counts. */
  async function seedBaseline(groupId: string, windowStart: Date, perBucket: number) {
    await prisma.errorGroup.update({ where: { id: groupId }, data: { firstSeenAt: new Date('2020-01-01T00:00:00.000Z') } });
    const rows: Array<[Date, number]> = [];
    for (let i = 1; i <= 96; i++) rows.push([new Date(windowStart.getTime() - i * 15 * MINUTE), perBucket]);
    await setBuckets(groupId, rows);
  }
  const spikeAlerts = (groupId: string) => prisma.errorAlert.findMany({ where: { groupId, kind: 'SPIKE' }, orderBy: { windowStart: 'asc' } });
  const adminGet = (path: string) => request(server).get(path).set('Authorization', `Bearer ${superAdminToken}`);
  const adminPost = (path: string, body: object = {}) => request(server).post(path).set('Authorization', `Bearer ${superAdminToken}`).send(body);

  async function cleanup() {
    const groups = await prisma.errorGroup.findMany({ where: { fingerprint: { contains: RUN } }, select: { id: true } });
    const ids = groups.map((g) => g.id);
    await prisma.auditLog.deleteMany({ where: { entityType: 'ErrorGroup', entityId: { in: ids } } });
    await prisma.errorGroup.deleteMany({ where: { id: { in: ids } } });
    await prisma.errorSettings.deleteMany({});
    await prisma.errorStudioSetting.deleteMany({ where: { studioId: { in: [ZEN, FLOW] } } });
  }

  beforeAll(async () => {
    mapDir = await fs.mkdtemp(join(tmpdir(), 'e2e-h3-maps-'));
    process.env.SOURCEMAP_DIR = mapDir;
    http = new StubAlertHttp();
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AlertHttpClient)
      .useValue(http)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureBodyParsers(app as NestExpressApplication);
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    capture = app.get(ErrorCaptureService);
    limiter = app.get(TelemetryRateLimiter);
    spikes = app.get(ErrorSpikeService);
    dispatcher = app.get(AlertSinkDispatcher);
    store = app.get(SourcemapStoreService);

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    await cleanup();
    superAdminToken = await login(SUPER_ADMIN_PHONE);
    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
    // The demo owner has no e-mail address; the owner notice needs one.
    const owner = await prisma.user.findUniqueOrThrow({ where: { phone: OWNER_PHONE } });
    ownerOriginalEmail = owner.email;
    await prisma.user.update({ where: { id: owner.id }, data: { email: `${RUN}owner@example.com` } });
    superAdminsWithEmail = await prisma.user.count({ where: { isSuperAdmin: true, isActive: true, email: { not: null } } });
  });

  afterAll(async () => {
    await capture.flush();
    await cleanup();
    await prisma.user.update({ where: { phone: OWNER_PHONE }, data: { email: ownerOriginalEmail } });
    await prisma.$disconnect();
    await app.close();
    await fs.rm(mapDir, { recursive: true, force: true });
    delete process.env.SOURCEMAP_DIR;
  });

  beforeEach(() => {
    limiter.reset();
    http.reset();
  });

  describe('alert settings', () => {
    it('is super admin only', async () => {
      await request(server).get('/admin/errors/settings').set('Authorization', `Bearer ${ownerToken}`).expect(403);
      await request(server).patch('/admin/errors/settings').set('Authorization', `Bearer ${ownerToken}`).send({ cooldownMinutes: 30 }).expect(403);
      await request(server).get('/admin/errors/alerts').set('Authorization', `Bearer ${trainerToken}`).expect(403);
    });

    it('rejects private webhook addresses, foreign Slack hosts and bad thresholds', async () => {
      const patch = (body: object) => request(server).patch('/admin/errors/settings').set('Authorization', `Bearer ${superAdminToken}`).send(body);
      expect((await patch({ webhook: { url: 'https://127.0.0.1/hook', secret: WEBHOOK_SECRET } })).status).toBe(400);
      expect((await patch({ webhook: { url: 'https://169.254.169.254/latest', secret: WEBHOOK_SECRET } })).status).toBe(400);
      expect((await patch({ webhook: { url: 'http://93.184.216.34/hook', secret: WEBHOOK_SECRET } })).status).toBe(400);
      expect((await patch({ slack: { url: 'https://evil.example.com/services/T000/B000/x' } })).status).toBe(400);
      expect((await patch({ spike: { ratio: 0.5 } })).status).toBe(400);
      expect((await patch({ cooldownMinutes: 1 })).status).toBe(400);
    });

    it('stores the sink destinations encrypted and never returns them', async () => {
      const res = await request(server)
        .patch('/admin/errors/settings')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ cooldownMinutes: 60, webhook: { url: WEBHOOK_URL, secret: WEBHOOK_SECRET }, slack: { url: SLACK_URL } });
      expect(res.status).toBe(200);
      expect(res.body.webhook).toMatchObject({ configured: true, host: '93.184.216.34', secretLast4: WEBHOOK_SECRET.slice(-4), enabled: true });
      expect(res.body.slack.configured).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(WEBHOOK_SECRET);
      expect(JSON.stringify(res.body)).not.toContain('e2ealerts');
      const row = await prisma.errorSettings.findUniqueOrThrow({ where: { id: 'platform' } });
      expect(row.webhookUrlEncrypted).not.toContain('93.184.216.34/e2e-errors');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'error_settings.update' }, orderBy: { createdAt: 'desc' } });
      expect(JSON.stringify(audit.metadata)).not.toContain(WEBHOOK_SECRET);
      expect((await adminGet('/admin/errors/settings')).body.slack.configured).toBe(true);
    });
  });

  describe('spike alerts', () => {
    const now = new Date('2031-03-01T12:07:00.000Z'); // current bucket 12:00, previous 11:45

    it('creates one alert per cooldown and another after it, with e-mail and signed sink delivery', async () => {
      const { group } = await seedGroup('spike');
      const windowStart = new Date('2031-03-01T11:45:00.000Z');
      await seedBaseline(group.id, windowStart, 2);
      await setBuckets(group.id, [[windowStart, 40]]);
      http.reset(); // the calls of the new-group alert raised while seeding do not count
      const spikeMails = () => prisma.notificationLog.count({ where: { type: 'ERROR_SPIKE', channel: 'EMAIL', content: { contains: tag('spike') } } });

      // The webhook answers 503 first: the first attempt fails and stays pending.
      http.statuses = [503];
      const first = await spikes.run(now);
      expect(first.alerts).toBe(1);
      let alerts = await spikeAlerts(group.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ windowCount: 40, threshold: 10, baselineTotal: 192, baselineMean: 2 });
      expect(alerts[0].notifiedAt).not.toBeNull();
      expect(await spikeMails()).toBe(superAdminsWithEmail);

      // Inside the cooldown (window 12:00 is 15 minutes after the alerted one): nothing new.
      await setBuckets(group.id, [[new Date('2031-03-01T12:00:00.000Z'), 40]]);
      expect((await spikes.run(new Date('2031-03-01T12:22:00.000Z'))).alerts).toBe(0);
      expect(await spikeAlerts(group.id)).toHaveLength(1);

      // After the cooldown a new window alerts again.
      await setBuckets(group.id, [[new Date('2031-03-01T12:45:00.000Z'), 40]]);
      expect((await spikes.run(new Date('2031-03-01T12:52:00.000Z'))).alerts).toBe(1);
      alerts = await spikeAlerts(group.id);
      expect(alerts).toHaveLength(2);
      expect(await spikeMails()).toBe(superAdminsWithEmail * 2);

      // The first delivery of the first alert hit the webhook (503) and the Slack URL (200).
      const webhookCalls = http.calls.filter((c) => c.url === WEBHOOK_URL);
      const slackCalls = http.calls.filter((c) => c.url === SLACK_URL);
      expect(webhookCalls.length).toBeGreaterThanOrEqual(2);
      expect(slackCalls.length).toBeGreaterThanOrEqual(2);
      const signed = webhookCalls[0];
      expect(verifySignatureHeader(WEBHOOK_SECRET, signed.body, signed.headers['x-signature'])).toBe(true);
      const payload = JSON.parse(signed.body) as { event: string; alert: { kind: string; windowCount: number; title: string } };
      expect(payload).toMatchObject({ event: 'error.alert', alert: { kind: 'SPIKE', windowCount: 40 } });
      expect(signed.body).not.toContain('ada@example.com');
      expect(JSON.parse(slackCalls[0].body).blocks).toBeDefined();

      // Retry with backoff: the 503 delivery is pending after one attempt, and goes through on the retry.
      const deliveries = await prisma.errorAlertDelivery.findMany({ where: { alertId: alerts[0].id, sink: 'WEBHOOK' } });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({ status: 'PENDING', attempt: 1, lastStatusCode: 503 });
      expect(deliveries[0].nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());
      http.reset();
      const retried = await dispatcher.retryDue(new Date('2031-03-01T13:30:00.000Z'));
      expect(retried.succeeded).toBeGreaterThanOrEqual(1);
      const after = await prisma.errorAlertDelivery.findUniqueOrThrow({ where: { id: deliveries[0].id } });
      expect(after).toMatchObject({ status: 'SUCCEEDED', attempt: 2, lastError: null });
      expect(verifySignatureHeader(WEBHOOK_SECRET, http.calls[0].body, http.calls[0].headers['x-signature'])).toBe(true);
    });

    it('abandons a delivery after repeated failures without storing the payload', async () => {
      const { group } = await seedGroup('abandon');
      const windowStart = new Date('2031-04-01T11:45:00.000Z');
      await seedBaseline(group.id, windowStart, 2);
      await setBuckets(group.id, [[windowStart, 40]]);
      http.statuses = Array.from({ length: 40 }, () => 500);
      expect((await spikes.run(new Date('2031-04-01T12:07:00.000Z'))).alerts).toBe(1);
      const alert = (await spikeAlerts(group.id))[0];
      for (let i = 1; i <= 8; i++) await dispatcher.retryDue(new Date(Date.parse('2031-04-01T12:07:00.000Z') + i * 24 * 60 * MINUTE));
      const deliveries = await prisma.errorAlertDelivery.findMany({ where: { alertId: alert.id } });
      expect(deliveries.length).toBe(2);
      for (const d of deliveries) {
        expect(d.status).toBe('ABANDONED');
        expect(d.attempt).toBe(6);
        expect(d.lastError).toBe('HTTP 500');
        expect(JSON.stringify(d)).not.toContain(WEBHOOK_SECRET);
      }
    });

    it('does not alert on a quiet group, an ignored group or a thin baseline', async () => {
      const quiet = (await seedGroup('quiet')).group;
      const ignored = (await seedGroup('ignored')).group;
      const thin = (await seedGroup('thin')).group;
      const windowStart = new Date('2031-05-01T11:45:00.000Z');
      await seedBaseline(quiet.id, windowStart, 2);
      await setBuckets(quiet.id, [[windowStart, 9]]); // below minWindowCount 10
      await seedBaseline(ignored.id, windowStart, 2);
      await setBuckets(ignored.id, [[windowStart, 500]]);
      await prisma.errorGroup.update({ where: { id: ignored.id }, data: { status: 'IGNORED' } });
      await prisma.errorGroup.update({ where: { id: thin.id }, data: { firstSeenAt: new Date('2020-01-01T00:00:00.000Z') } });
      await setBuckets(thin.id, [[new Date(windowStart.getTime() - 15 * MINUTE), 5], [windowStart, 30]]); // baseline 5 < 20, 30 < floor 50
      await spikes.run(new Date('2031-05-01T12:07:00.000Z'));
      expect(await spikeAlerts(quiet.id)).toHaveLength(0);
      expect(await spikeAlerts(ignored.id)).toHaveLength(0);
      expect(await spikeAlerts(thin.id)).toHaveLength(0);
      // The same thin group above the absolute floor does alert.
      await setBuckets(thin.id, [[windowStart, 60]]);
      await spikes.run(new Date('2031-05-01T12:08:00.000Z'));
      expect(await spikeAlerts(thin.id)).toHaveLength(1);
    });

    it('lists alerts for the super admin and acknowledges them once', async () => {
      const group = (await groupOf('spike'))!;
      const list = await adminGet(`/admin/errors/alerts?groupId=${group.id}&kind=SPIKE`);
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(2);
      expect(list.body.items[0].deliveries.map((d: { sink: string }) => d.sink).sort()).toEqual(['SLACK', 'WEBHOOK']);
      const id = list.body.items[0].id as string;
      const ack = await adminPost(`/admin/errors/alerts/${id}/acknowledge`);
      expect(ack.status).toBe(200);
      expect(ack.body.acknowledgedAt).not.toBeNull();
      const firstAck = ack.body.acknowledgedAt as string;
      expect((await adminPost(`/admin/errors/alerts/${id}/acknowledge`)).body.acknowledgedAt).toBe(firstAck);
      const open = await adminGet(`/admin/errors/alerts?groupId=${group.id}&kind=SPIKE&acknowledged=false`);
      expect(open.body.total).toBe(1);
      await request(server).post(`/admin/errors/alerts/${id}/acknowledge`).set('Authorization', `Bearer ${ownerToken}`).expect(403);
      // The detail page lists the group's alerts and the group list shows no merged groups.
      const detail = await adminGet(`/admin/errors/${group.id}`);
      expect(detail.body.alerts.length).toBe(3); // two spikes and the new-group alert
    });
  });

  describe('regression and new group alerts', () => {
    it('stores a NEW_GROUP alert, then a REGRESSION alert when a resolved group returns in another release', async () => {
      const { group } = await seedGroup('regress', { release: 'sha-old' });
      expect(await prisma.errorAlert.count({ where: { groupId: group.id, kind: 'NEW_GROUP' } })).toBe(1);
      await adminPost(`/admin/errors/${group.id}/resolve`, { release: 'sha-old' }).expect(200);
      await sleep(1100);
      await ingest({ events: [clientEvent('regress', { release: 'sha-new' })] }).expect(202);
      await capture.flush();
      const fresh = (await groupOf('regress'))!;
      expect(fresh.status).toBe('OPEN');
      const regressions = await prisma.errorAlert.findMany({ where: { groupId: group.id, kind: 'REGRESSION' } });
      expect(regressions).toHaveLength(1);
      // Both went to the configured sinks.
      const deliveries = await prisma.errorAlertDelivery.count({ where: { alert: { groupId: group.id } } });
      expect(deliveries).toBe(4);
    });
  });

  describe('group merging', () => {
    it('re-points events and aliases the fingerprint so future events land in the target', async () => {
      const a = (await seedGroup('mergea')).group;
      const b = (await seedGroup('mergeb')).group;
      await prisma.errorGroupBucket.create({ data: { groupId: a.id, bucketStart: new Date('2031-06-01T10:00:00.000Z'), count: 3 } });
      await prisma.errorGroupBucket.create({ data: { groupId: b.id, bucketStart: new Date('2031-06-01T10:00:00.000Z'), count: 4 } });

      const res = await adminPost(`/admin/errors/groups/${a.id}/merge`, { targetId: b.id });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(b.id);
      expect(res.body.count).toBe(2);

      const source = await prisma.errorGroup.findUniqueOrThrow({ where: { id: a.id } });
      expect(source.mergedIntoId).toBe(b.id);
      expect(await prisma.errorEvent.count({ where: { groupId: a.id } })).toBe(0);
      expect(await prisma.errorEvent.count({ where: { groupId: b.id } })).toBe(2);
      expect(await prisma.errorAlert.count({ where: { groupId: a.id } })).toBe(0);
      const alias = await prisma.errorGroupAlias.findUniqueOrThrow({ where: { fingerprintHash: a.fingerprintHash } });
      expect(alias.groupId).toBe(b.id);
      const bucket = await prisma.errorGroupBucket.findUniqueOrThrow({ where: { groupId_bucketStart: { groupId: b.id, bucketStart: new Date('2031-06-01T10:00:00.000Z') } } });
      expect(bucket.count).toBe(7);
      expect(await prisma.errorGroupBucket.count({ where: { groupId: a.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: 'error_group.merge', entityId: a.id } })).toBe(1);

      // A new event with the merged fingerprint lands in the target; the source stays untouched.
      await sleep(1100);
      await ingest({ events: [clientEvent('mergea')] }).expect(202);
      await capture.flush();
      expect(await prisma.errorEvent.count({ where: { groupId: b.id } })).toBe(3);
      expect((await prisma.errorGroup.findUniqueOrThrow({ where: { id: b.id } })).count).toBe(3);
      expect((await prisma.errorGroup.findUniqueOrThrow({ where: { id: a.id } })).count).toBe(1);
      expect(await prisma.errorGroup.count({ where: { fingerprint: { contains: tag('mergea') }, mergedIntoId: null } })).toBe(0);

      // The merged group is not listed; its detail points at the target and the target counts the alias.
      const listed = await adminGet(`/admin/errors?q=${tag('mergea')}`);
      expect(listed.body.items.map((g: { id: string }) => g.id)).not.toContain(a.id);
      expect((await adminGet(`/admin/errors/${a.id}`)).body.mergedIntoId).toBe(b.id);
      expect((await adminGet(`/admin/errors/${b.id}`)).body.aliasCount).toBe(1);
    });

    it('moves aliases along when the target is merged again, and refuses invalid merges', async () => {
      const b = (await groupOf('mergeb'))!;
      const c = (await seedGroup('mergec')).group;
      await adminPost(`/admin/errors/groups/${b.id}/merge`, { targetId: c.id }).expect(200);
      const a = (await groupOf('mergea'))!;
      expect((await prisma.errorGroupAlias.findUniqueOrThrow({ where: { fingerprintHash: a.fingerprintHash } })).groupId).toBe(c.id);
      expect((await prisma.errorGroupAlias.findUniqueOrThrow({ where: { fingerprintHash: b.fingerprintHash } })).groupId).toBe(c.id);
      await sleep(1100);
      await ingest({ events: [clientEvent('mergea')] }).expect(202);
      await capture.flush();
      expect((await prisma.errorGroup.findUniqueOrThrow({ where: { id: c.id } })).count).toBe(5);

      expect((await adminPost(`/admin/errors/groups/${c.id}/merge`, { targetId: c.id })).status).toBe(409);
      expect((await adminPost(`/admin/errors/groups/${b.id}/merge`, { targetId: c.id })).status).toBe(409);
      expect((await adminPost(`/admin/errors/groups/${c.id}/merge`, { targetId: b.id })).status).toBe(409);
      expect((await adminPost(`/admin/errors/groups/${c.id}/merge`, { targetId: randomUUID() })).status).toBe(404);
      expect((await adminPost(`/admin/errors/groups/${c.id}/merge`, { targetId: 'nope' })).status).toBe(400);
      await request(server).post(`/admin/errors/groups/${c.id}/merge`).set('Authorization', `Bearer ${ownerToken}`).send({ targetId: b.id }).expect(403);
    });
  });

  describe('owner notification', () => {
    const ownerMails = (studioId: string) => prisma.notificationLog.count({ where: { type: 'ERROR_OWNER_NOTICE', studioId, createdAt: { gte: startedAt } } });

    it('is off by default, needs the settings permission to change and reads back', async () => {
      const get = await request(server).get(`/studios/${ZEN}/errors/settings`).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN);
      expect(get.status).toBe(200);
      expect(get.body).toEqual({ ownerNotify: false });
      await request(server).patch(`/studios/${ZEN}/errors/settings`).set('Authorization', `Bearer ${trainerToken}`).set('x-studio-id', ZEN).send({ ownerNotify: true }).expect(403);
      await request(server).patch(`/studios/${ZEN}/errors/settings`).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN).send({ ownerNotify: 'yes' }).expect(400);
    });

    it('sends nothing while off, then one e-mail per group per day once opted in', async () => {
      const before = await ownerMails(ZEN);
      await seedGroup('ownoff', {}, ownerToken, ZEN);
      expect(await ownerMails(ZEN)).toBe(before);

      const patch = await request(server).patch(`/studios/${ZEN}/errors/settings`).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN).send({ ownerNotify: true });
      expect(patch.status).toBe(200);
      expect(patch.body).toEqual({ ownerNotify: true });

      const { group } = await seedGroup('ownon', {}, ownerToken, ZEN);
      expect(await ownerMails(ZEN)).toBe(before + 1);
      const row = await prisma.errorGroupStudio.findUniqueOrThrow({ where: { groupId_studioId: { groupId: group.id, studioId: ZEN } } });
      expect(row.ownerNotifiedAt).not.toBeNull();

      // A spike of the same group inside 24 hours sends no second e-mail.
      const windowStart = new Date('2031-07-01T11:45:00.000Z');
      await seedBaseline(group.id, windowStart, 2);
      await setBuckets(group.id, [[windowStart, 40]]);
      // Notified two hours before the spike window, on the same fake clock as the spike run.
      await prisma.errorGroupStudio.update({
        where: { groupId_studioId: { groupId: group.id, studioId: ZEN } },
        data: { lastSeenAt: new Date('2031-07-01T11:50:00.000Z'), ownerNotifiedAt: new Date('2031-07-01T10:00:00.000Z') },
      });
      expect((await spikes.run(new Date('2031-07-01T12:07:00.000Z'))).alerts).toBe(1);
      expect(await ownerMails(ZEN)).toBe(before + 1);

      // A day later a new spike window mails again.
      await prisma.errorGroupStudio.update({ where: { groupId_studioId: { groupId: group.id, studioId: ZEN } }, data: { ownerNotifiedAt: new Date('2031-06-30T12:00:00.000Z') } });
      const later = new Date('2031-07-01T13:52:00.000Z');
      await setBuckets(group.id, [[new Date('2031-07-01T13:45:00.000Z'), 40]]);
      await prisma.errorGroupStudio.update({ where: { groupId_studioId: { groupId: group.id, studioId: ZEN } }, data: { lastSeenAt: new Date('2031-07-01T13:50:00.000Z') } });
      expect((await spikes.run(later)).alerts).toBe(1);
      expect(await ownerMails(ZEN)).toBe(before + 2);
    });

    it('never mails another studio that did not opt in', async () => {
      const before = await ownerMails(FLOW);
      await seedGroup('flow', {}, flowOwnerToken, FLOW);
      expect(await ownerMails(FLOW)).toBe(before);
    });
  });

  describe('user feedback', () => {
    const feedback = (eventId: string, body: unknown, token?: string) => {
      const req = request(server).post(`/telemetry/errors/${eventId}/feedback`);
      if (token) req.set('Authorization', `Bearer ${token}`);
      return req.send(body as object);
    };

    it('stores a scrubbed note once and shows it on the admin event', async () => {
      const { group, eventId } = await seedGroup('fb');
      const res = await feedback(eventId, { feedback: 'I pressed Save and mailed ada@example.com or +90 532 123 45 67' });
      expect(res.status).toBe(202);
      const event = await prisma.errorEvent.findUniqueOrThrow({ where: { id: eventId } });
      expect(event.feedback).toContain('I pressed Save');
      expect(event.feedback).toContain('[email]');
      expect(event.feedback).toContain('[phone]');
      expect(event.feedback).not.toContain('ada@example.com');
      expect((await feedback(eventId, { feedback: 'again' })).status).toBe(409);
      const detail = await adminGet(`/admin/errors/${group.id}`);
      expect(detail.body.events[0].feedback).toBe(event.feedback);
    });

    it('cuts to 500 characters and rejects empty, oversized, invalid and unknown input', async () => {
      const { eventId } = await seedGroup('fblong');
      expect((await feedback(eventId, { feedback: 'x'.repeat(900) })).status).toBe(202);
      expect((await prisma.errorEvent.findUniqueOrThrow({ where: { id: eventId } })).feedback).toHaveLength(500);
      const other = (await seedGroup('fbempty')).eventId;
      expect((await feedback(other, { feedback: '   ' })).status).toBe(400);
      expect((await feedback(other, { feedback: 'x'.repeat(1001) })).status).toBe(400);
      expect((await feedback(other, {})).status).toBe(400);
      expect((await feedback('not-a-uuid', { feedback: 'x' })).status).toBe(400);
      expect((await feedback(randomUUID(), { feedback: 'x' })).status).toBe(404);
    });

    it('accepts a signed-in event only from its own user', async () => {
      const { eventId } = await seedGroup('fbown', {}, ownerToken, ZEN);
      expect((await feedback(eventId, { feedback: 'anonymous try' })).status).toBe(404);
      expect((await feedback(eventId, { feedback: 'other user try' }, flowOwnerToken)).status).toBe(404);
      expect((await feedback(eventId, { feedback: 'my own note' }, ownerToken)).status).toBe(202);
    });

    it('rate limits like the error batch endpoint', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 61; i++) statuses.push((await feedback(randomUUID(), { feedback: 'x' })).status);
      expect(statuses.slice(0, 60).every((s) => s === 404)).toBe(true);
      expect(statuses[60]).toBe(429);
    });
  });

  describe('source context', () => {
    it('adds the lines around the resolved frame when the map embeds sourcesContent, leaving the raw stack alone', async () => {
      await store.save({ platform: 'web', release: RELEASE, path: BUNDLE_PATH, mapText: MAP });
      const stack = `TypeError: x\n    at a (https://app.example.com/${BUNDLE_PATH}?dpl=1:1:16)`;
      const { group, eventId } = await seedGroup('ctx', { stack });
      const event = await prisma.errorEvent.findUniqueOrThrow({ where: { id: eventId } });
      expect(event.stack).toBe(stack);
      expect(event.symbolicatedStack).toContain('src/app.ts:2:3');
      expect(event.symbolicatedContext).toEqual([
        { location: 'src/app.ts:2:3', startLine: 1, lines: ['export function fail() {', '  throw new Error("boom");', '}'], focus: 1 },
      ]);
      const detail = await adminGet(`/admin/errors/${group.id}`);
      expect(detail.body.events[0].symbolicatedContext[0].lines[1]).toBe('  throw new Error("boom");');
      expect(detail.body.events[0].stack).toBe(stack);
    });

    it('stores no context when the map has no sourcesContent', async () => {
      const plain = JSON.stringify({ version: 3, sources: ['webpack://_N_E/./src/app.ts'], names: [], mappings: 'AAAA,cACE' });
      const path = `_next/static/chunks/${RUN}plain.js`;
      await store.save({ platform: 'web', release: RELEASE, path, mapText: plain });
      const { eventId } = await seedGroup('noctx', { stack: `TypeError: x\n    at a (https://app.example.com/${path}?dpl=1:1:16)` });
      const event = await prisma.errorEvent.findUniqueOrThrow({ where: { id: eventId } });
      expect(event.symbolicatedStack).toContain('src/app.ts:2:3');
      expect(event.symbolicatedContext).toBeNull();
    });
  });
});
