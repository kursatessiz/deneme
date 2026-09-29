import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@platform/database';
import { normalizePhone } from '@platform/shared';

// The deterministic publishers of the automated suites: the pasted token picks the behaviour
// (FAKE_QUOTA, FAKE_5XX, FAKE_4XX), nothing ever reaches a real network. Must be set before AppModule loads.
process.env.SOCIAL_FAKE_PROVIDER = '1';

import { AppModule } from '../../src/app.module';

/**
 * M4b organic social publishing (docs/PAZARLAMA_MODULU.md 5.2, 6.1): connection
 * CRUD with masked credentials, a clean post that self-approves and is
 * published by the heartbeat, a blocking brand check or the tenant setting
 * that sends it to a super admin, the Instagram quota, 4xx and 5xx failures,
 * the linked calendar item, tenant isolation and audit rows. Everything
 * created here is removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const ZEN_OWNER_PHONE = '+905321000002';
const HOUR = 3_600_000;
const MINUTE = 60_000;
const TOKEN = 'EAAB-e2e-token-7788';
const LABEL = 'M4b e2e';

describe('Social publishing (M4b) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const startedAt = new Date();
  const runId = Date.now().toString().slice(-7);

  let PLATFORM: string;
  let ZEN: string;
  let superAdminToken: string;
  let superAdminId: string;
  let ownerToken: string;
  let marketingToken: string;
  let marketingUserId: string;
  let viewerToken: string;
  let previousMfaPolicy: boolean | undefined;

  const marketingPhone = normalizePhone(`0535${runId}`)!;
  const viewerPhone = normalizePhone(`0533${runId}`)!;
  const viewerRoleKey = `m4b_viewer_${runId}`;
  const connectionIds: string[] = [];
  const postIds: string[] = [];
  const calendarIds: string[] = [];

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`),
  });
  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const runScheduler = async (now: Date) => {
    const res = await as(superAdminToken).post('/admin/scheduler/run').send({ now: now.toISOString() });
    expect(res.status).toBe(201);
    return res.body;
  };
  const inHours = (h: number) => new Date(Date.now() + h * HOUR);

  async function newConnection(provider: 'META_PAGE' | 'INSTAGRAM' | 'LINKEDIN_ORG', suffix: string, token = TOKEN): Promise<string> {
    const res = await as(marketingToken)
      .post('/platform/integrations/social')
      .send({ provider, externalId: `m4b${runId}${suffix}`, displayName: `${LABEL} ${suffix}`, credentials: { accessToken: token } });
    expect(res.status).toBe(201);
    connectionIds.push(res.body.id);
    return res.body.id as string;
  }

  async function newPost(connectionId: string, body: Record<string, unknown> = {}, token = marketingToken): Promise<string> {
    const res = await as(token)
      .post('/platform/marketing/social-posts')
      .send({ connectionId, locale: 'tr', text: `${LABEL} yeni hafta programi hazir`, ...body });
    expect(res.status).toBe(201);
    postIds.push(res.body.id);
    return res.body.id as string;
  }

  const schedule = (id: string, at: Date, token = marketingToken) => as(token).post(`/platform/marketing/social-posts/${id}/schedule`).send({ scheduledAt: at.toISOString() });
  const postRow = (id: string) => prisma.socialPost.findUniqueOrThrow({ where: { id } });
  const setApprovalSetting = async (value: boolean) => {
    expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ requireApprovalForSocial: value })).status).toBe(200);
  };

  async function cleanup(): Promise<void> {
    const posts = await prisma.socialPost.findMany({ where: { studioId: PLATFORM, OR: [{ text: { startsWith: LABEL } }, { id: { in: postIds } }] }, select: { id: true } });
    const ids = [...new Set([...posts.map((p) => p.id), ...postIds])];
    await prisma.approvalRequest.deleteMany({ where: { studioId: PLATFORM, targetType: 'SOCIAL_POST', targetId: { in: ids } } });
    await prisma.socialPost.deleteMany({ where: { id: { in: ids } } });
    await prisma.socialConnection.deleteMany({ where: { OR: [{ displayName: { startsWith: LABEL } }, { id: { in: connectionIds } }] } });
    await prisma.contentCalendarItem.deleteMany({ where: { studioId: PLATFORM, OR: [{ title: { startsWith: LABEL } }, { id: { in: calendarIds } }] } });
    await prisma.notificationLog.deleteMany({ where: { studioId: PLATFORM, type: { startsWith: 'MARKETING_APPROVAL' }, createdAt: { gte: startedAt } } });
    await prisma.marketingSettings.deleteMany({ where: { studioId: PLATFORM } });
    await prisma.auditLog.deleteMany({
      where: {
        studioId: PLATFORM,
        createdAt: { gte: startedAt },
        OR: [{ action: { startsWith: 'social.' } }, { action: { startsWith: 'integration.social.' } }, { action: { startsWith: 'marketing.approval.' } }, { action: 'marketing.settings.updated' }, { action: { startsWith: 'marketing.calendar.' } }],
      },
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    PLATFORM = (await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } })).id;
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    await cleanup();

    const previous = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
    previousMfaPolicy = previous?.require2faForPlatformRoles;
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', require2faForPlatformRoles: false }, update: { require2faForPlatformRoles: false } });
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const marketingRole = await prisma.platformRoleTemplate.findUniqueOrThrow({ where: { key: 'marketing_admin' } });
    const viewerRole = await prisma.platformRoleTemplate.create({
      data: { key: viewerRoleKey, name: 'M4b salt okunur', permissions: { create: [{ permissionKey: 'platform.marketing.view' }] } },
    });
    const marketing = await prisma.user.create({ data: { phone: marketingPhone, firstName: 'Pazarlama', lastName: 'Sosyal', passwordHash, phoneVerifiedAt: new Date() } });
    const viewer = await prisma.user.create({ data: { phone: viewerPhone, firstName: 'Salt', lastName: 'Sosyal', passwordHash, phoneVerifiedAt: new Date() } });
    marketingUserId = marketing.id;
    await prisma.platformMembership.create({ data: { userId: marketing.id, roleTemplateId: marketingRole.id, status: 'ACTIVE', activatedAt: new Date() } });
    await prisma.platformMembership.create({ data: { userId: viewer.id, roleTemplateId: viewerRole.id, status: 'ACTIVE', activatedAt: new Date() } });

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    superAdminId = (await prisma.user.findUniqueOrThrow({ where: { phone: SUPER_ADMIN_PHONE } })).id;
    ownerToken = await login(ZEN_OWNER_PHONE);
    marketingToken = await login(marketingPhone);
    viewerToken = await login(viewerPhone);
  });

  afterAll(async () => {
    await cleanup();
    const users = await prisma.user.findMany({ where: { phone: { in: [marketingPhone, viewerPhone] } }, select: { id: true } });
    await prisma.notificationLog.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await prisma.platformRoleTemplate.deleteMany({ where: { key: viewerRoleKey } });
    if (previousMfaPolicy !== undefined) {
      await prisma.platformAccessSettings.update({ where: { id: 'platform' }, data: { require2faForPlatformRoles: previousMfaPolicy } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('connections', () => {
    it('creates, lists, tests, updates and deletes a connection; the credential is never returned', async () => {
      const created = await as(marketingToken)
        .post('/platform/integrations/social')
        .send({ provider: 'META_PAGE', externalId: `m4b${runId}crud`, displayName: `${LABEL} crud`, credentials: { accessToken: TOKEN } });
      expect(created.status).toBe(201);
      connectionIds.push(created.body.id);
      expect(created.body).toMatchObject({ provider: 'META_PAGE', status: 'CONNECTED', credentialPreview: '****7788', connectedByUserId: marketingUserId });
      expect(JSON.stringify(created.body)).not.toContain(TOKEN);
      expect(created.body).not.toHaveProperty('encryptedCredentials');

      const stored = await prisma.socialConnection.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(stored.encryptedCredentials).not.toContain(TOKEN);
      expect(stored.credentialLast4).toBe('7788');

      const dup = await as(marketingToken)
        .post('/platform/integrations/social')
        .send({ provider: 'META_PAGE', externalId: `m4b${runId}crud`, credentials: { accessToken: TOKEN } });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('SOCIAL_CONNECTION_DUPLICATE');

      const bad = await as(marketingToken).post('/platform/integrations/social').send({ provider: 'TIKTOK', externalId: 'x', credentials: { accessToken: TOKEN } });
      expect(bad.status).toBe(400);

      const hub = await as(marketingToken).get('/platform/integrations');
      expect(hub.status).toBe(200);
      const card = hub.body.socialConnections.find((c: { id: string }) => c.id === created.body.id);
      expect(card).toMatchObject({ provider: 'META_PAGE', status: 'CONNECTED', lastError: null, credentialPreview: '****7788' });
      expect(JSON.stringify(hub.body)).not.toContain(TOKEN);
      expect((await as(marketingToken).get('/platform/integrations/social')).body.some((c: { id: string }) => c.id === created.body.id)).toBe(true);

      const tested = await as(marketingToken).post(`/platform/integrations/social/${created.body.id}/test`).send({});
      expect(tested.status).toBe(200);
      expect(tested.body).toMatchObject({ ok: true, error: null });
      expect(tested.body.displayName).toContain('Fake META_PAGE');

      const renamed = await as(marketingToken).patch(`/platform/integrations/social/${created.body.id}`).send({ displayName: `${LABEL} crud 2` });
      expect(renamed.status).toBe(200);
      expect(renamed.body.displayName).toBe(`${LABEL} crud 2`);
      const rotated = await as(marketingToken).patch(`/platform/integrations/social/${created.body.id}`).send({ credentials: { accessToken: 'EAAB-rotated-token-4321' } });
      expect(rotated.body.credentialPreview).toBe('****4321');
      expect((await as(marketingToken).patch(`/platform/integrations/social/${created.body.id}`).send({ externalId: 'other' })).status).toBe(400);

      // A token the network refuses shows as an error on the card, with a credential-free reason.
      const broken = await newConnection('LINKEDIN_ORG', 'broken', 'EAAB-FAKE_4XX-token');
      const failed = await as(marketingToken).post(`/platform/integrations/social/${broken}/test`).send({});
      expect(failed.body).toMatchObject({ ok: false, displayName: null });
      expect(failed.body.connection.status).toBe('ERROR');
      expect(failed.body.error).not.toContain('FAKE_4XX-token');
      const hub2 = await as(superAdminToken).get('/platform/integrations').set('x-platform-entry', 'admin');
      expect(hub2.body.socialConnections.find((c: { id: string }) => c.id === broken)).toMatchObject({ status: 'ERROR' });

      expect((await as(marketingToken).delete(`/platform/integrations/social/${created.body.id}`)).status).toBe(200);
      expect((await as(marketingToken).delete(`/platform/integrations/social/${created.body.id}`)).status).toBe(404);

      const audit = await prisma.auditLog.findMany({ where: { studioId: PLATFORM, action: { startsWith: 'integration.social.' }, entityId: created.body.id } });
      expect(audit.map((a) => a.action).sort()).toEqual(['integration.social.create', 'integration.social.delete', 'integration.social.test', 'integration.social.update', 'integration.social.update']);
      expect(audit.every((a) => a.userId === marketingUserId)).toBe(true);
      expect(JSON.stringify(audit)).not.toContain(TOKEN);
    });

    it('refuses everyone without platform.integrations.manage, and other tenants', async () => {
      const id = await newConnection('META_PAGE', 'perm');
      for (const token of [viewerToken, ownerToken]) {
        expect((await as(token).get('/platform/integrations/social')).status).toBe(403);
        expect((await as(token).post('/platform/integrations/social').send({ provider: 'META_PAGE', externalId: 'zzz', credentials: { accessToken: TOKEN } })).status).toBe(403);
        expect((await as(token).delete(`/platform/integrations/social/${id}`)).status).toBe(403);
      }
    });

    it('never shows or reaches another tenant connection', async () => {
      const foreign = await prisma.socialConnection.create({
        data: { studioId: ZEN, provider: 'META_PAGE', externalId: `m4b${runId}zen`, displayName: `${LABEL} zen`, encryptedCredentials: 'plain:eA==', credentialLast4: '0000' },
      });
      connectionIds.push(foreign.id);
      const list = await as(superAdminToken).get('/platform/integrations/social');
      expect(list.body.some((c: { id: string }) => c.id === foreign.id)).toBe(false);
      expect((await as(marketingToken).patch(`/platform/integrations/social/${foreign.id}`).send({ displayName: 'x' })).status).toBe(404);
      expect((await as(marketingToken).post(`/platform/integrations/social/${foreign.id}/test`).send({})).status).toBe(404);
      expect((await as(marketingToken).delete(`/platform/integrations/social/${foreign.id}`)).status).toBe(404);
      const res = await as(marketingToken).post('/platform/marketing/social-posts').send({ connectionId: foreign.id, locale: 'tr', text: `${LABEL} yabanci` });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SOCIAL_POST_INVALID');
    });
  });

  describe('a clean post', () => {
    it('is checked, self-approved, published by the heartbeat with an external id, and flips its calendar item to SENT', async () => {
      await setApprovalSetting(false);
      const connection = await newConnection('META_PAGE', 'clean');
      const item = await as(marketingToken)
        .post('/platform/marketing/calendar/items')
        .send({ title: `${LABEL} takvim`, channel: 'SOCIAL', scheduledDate: inHours(1).toISOString().slice(0, 10) });
      expect(item.status).toBe(201);
      calendarIds.push(item.body.id);

      const id = await newPost(connection, { calendarItemId: item.body.id, link: 'https://example.com/?utm_source=facebook' });
      const draft = await as(marketingToken).get(`/platform/marketing/social-posts/${id}`);
      expect(draft.body).toMatchObject({ status: 'DRAFT', provider: 'META_PAGE', calendarItemId: item.body.id, approval: null, externalPostId: null });
      expect(draft.body.brandCheck.issues).toEqual([]);
      expect(draft.body.textLimit).toBeGreaterThan(0);

      const calendar = await as(marketingToken).get(`/platform/marketing/calendar?from=${inHours(-48).toISOString().slice(0, 10)}&to=${inHours(72).toISOString().slice(0, 10)}`);
      expect(calendar.body.items.find((i: { id: string }) => i.id === item.body.id)).toMatchObject({ socialPostId: id, status: 'PLANNED' });

      const scheduled = await schedule(id, inHours(1));
      expect(scheduled.status).toBe(200);
      expect(scheduled.body).toMatchObject({ status: 'SCHEDULED', approval: { status: 'SELF_APPROVED', reasons: [] } });
      const request = await prisma.approvalRequest.findFirstOrThrow({ where: { targetType: 'SOCIAL_POST', targetId: id } });
      expect(request).toMatchObject({ status: 'SELF_APPROVED', decidedByUserId: marketingUserId });
      expect(request.contentHash).toMatch(/^[0-9a-f]{64}$/);

      // Not due yet: nothing goes out.
      await runScheduler(new Date());
      expect((await postRow(id)).status).toBe('SCHEDULED');

      const run = await runScheduler(inHours(2));
      expect(run.socialPublishing.published).toBeGreaterThanOrEqual(1);
      const done = await postRow(id);
      expect(done.status).toBe('PUBLISHED');
      expect(done.externalPostId).toMatch(/^fake_meta_page_[0-9a-f]{12}$/);
      expect(done.publishedAt).not.toBeNull();
      expect((await prisma.contentCalendarItem.findUniqueOrThrow({ where: { id: item.body.id } })).status).toBe('SENT');

      // A published post is history: no edit, no cancel, no second send.
      expect((await as(marketingToken).patch(`/platform/marketing/social-posts/${id}`).send({ text: `${LABEL} degisti` })).status).toBe(409);
      expect((await as(marketingToken).post(`/platform/marketing/social-posts/${id}/cancel`).send({})).status).toBe(409);
      const before = (await postRow(id)).externalPostId;
      await runScheduler(inHours(3));
      expect((await postRow(id)).externalPostId).toBe(before);

      const actions = (await prisma.auditLog.findMany({ where: { studioId: PLATFORM, entityId: id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(['social.post.create', 'social.post.scheduled', 'social.post.published']);
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, entityId: request.id, action: 'marketing.approval.self_approved' } })).toBe(1);
    });

    it('publish-now sends right away when no approval is needed', async () => {
      await setApprovalSetting(false);
      const connection = await newConnection('LINKEDIN_ORG', 'now');
      const id = await newPost(connection);
      const res = await as(marketingToken).post(`/platform/marketing/social-posts/${id}/publish-now`).send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'PUBLISHED' });
      expect(res.body.externalPostId).toMatch(/^fake_linkedin_org_/);
      expect((await as(viewerToken).post(`/platform/marketing/social-posts/${id}/publish-now`).send({})).status).toBe(403);
    });

    it('validates the network rules and the schedule', async () => {
      await setApprovalSetting(false);
      const instagram = await newConnection('INSTAGRAM', 'shape');
      const id = await newPost(instagram);
      const noMedia = await schedule(id, inHours(1));
      expect(noMedia.status).toBe(400);
      expect(noMedia.body).toMatchObject({ code: 'SOCIAL_POST_INVALID', issues: ['MEDIA_REQUIRED'] });
      const linkedin = await newConnection('LINKEDIN_ORG', 'shape');
      const withMedia = await newPost(linkedin, { mediaUrls: ['https://example.com/a.jpg'] });
      expect((await schedule(withMedia, inHours(1))).body).toMatchObject({ code: 'SOCIAL_POST_INVALID', issues: ['MEDIA_NOT_SUPPORTED'] });
      const meta = await newConnection('META_PAGE', 'shape');
      const past = await newPost(meta);
      const late = await schedule(past, new Date(Date.now() - HOUR));
      expect(late.status).toBe(400);
      expect(late.body.code).toBe('SOCIAL_SCHEDULE_IN_PAST');
      expect((await as(marketingToken).post('/platform/marketing/social-posts').send({ connectionId: meta, locale: 'tr', text: 'x', mediaUrls: ['http://insecure.example.com/a.jpg'] })).status).toBe(400);
    });
  });

  describe('approval', () => {
    it('a blocking brand check needs a super admin; the requester cannot approve; the approval publishes it', async () => {
      await setApprovalSetting(false);
      const connection = await newConnection('META_PAGE', 'block');
      const id = await newPost(connection, { text: `${LABEL} <b>kalin</b> metin` });
      const draft = await as(marketingToken).get(`/platform/marketing/social-posts/${id}`);
      expect(draft.body.brandCheck.issues).toEqual([expect.objectContaining({ code: 'HTML', severity: 'BLOCKING' })]);

      const scheduled = await schedule(id, inHours(1));
      expect(scheduled.body).toMatchObject({ status: 'PENDING_APPROVAL', approval: { status: 'PENDING', reasons: ['SOCIAL_BRAND_CHECK_BLOCKING'] } });
      const requestId = scheduled.body.approval.id as string;
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM, userId: superAdminId, channel: 'IN_APP', type: 'MARKETING_APPROVAL_REQUESTED', createdAt: { gte: startedAt } } })).toBeGreaterThan(0);
      expect((await as(marketingToken).post(`/platform/marketing/social-posts/${id}/publish-now`).send({})).body.code).toBe('SOCIAL_APPROVAL_REQUIRED');

      await runScheduler(inHours(2));
      expect((await postRow(id)).status).toBe('PENDING_APPROVAL');

      expect((await as(marketingToken).post(`/platform/marketing/approvals/${requestId}/approve`).send({})).status).toBe(403);
      expect((await as(viewerToken).post(`/platform/marketing/approvals/${requestId}/approve`).send({})).status).toBe(403);
      const approved = await as(superAdminToken).post(`/platform/marketing/approvals/${requestId}/approve`).send({ note: 'Tamam' });
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', targetType: 'SOCIAL_POST', targetId: id });
      expect(approved.body.summary.social).toMatchObject({ provider: 'META_PAGE', mediaCount: 0 });
      expect((await postRow(id)).status).toBe('SCHEDULED');

      await runScheduler(inHours(2));
      const done = await postRow(id);
      expect(done.status).toBe('PUBLISHED');
      expect(done.externalPostId).not.toBeNull();
      const actions = (await prisma.auditLog.findMany({ where: { studioId: PLATFORM, entityId: id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(['social.post.create', 'social.post.approval_requested', 'social.post.approved', 'social.post.published']);
    });

    it('requireApprovalForSocial sends even a clean post to a super admin; a rejection returns it to draft', async () => {
      await setApprovalSetting(true);
      try {
        const connection = await newConnection('META_PAGE', 'setting');
        const id = await newPost(connection);
        const scheduled = await schedule(id, inHours(1));
        expect(scheduled.body).toMatchObject({ status: 'PENDING_APPROVAL', approval: { status: 'PENDING', reasons: ['SOCIAL_APPROVAL_REQUIRED_SETTING'] } });
        const requestId = scheduled.body.approval.id as string;

        expect((await as(superAdminToken).post(`/platform/marketing/approvals/${requestId}/reject`).send({})).status).toBe(400);
        const rejected = await as(superAdminToken).post(`/platform/marketing/approvals/${requestId}/reject`).send({ note: 'Metin degismeli' });
        expect(rejected.status).toBe(200);
        expect(rejected.body.status).toBe('REJECTED');
        expect((await postRow(id)).status).toBe('DRAFT');
        await runScheduler(inHours(2));
        expect((await postRow(id)).status).toBe('DRAFT');

        // Asking again works, and a super admin may approve their own request (recorded as self approval).
        const again = await as(superAdminToken).post(`/platform/marketing/social-posts/${id}/schedule`).send({ scheduledAt: inHours(1).toISOString() });
        expect(again.body.status).toBe('PENDING_APPROVAL');
        const own = await as(superAdminToken).post(`/platform/marketing/approvals/${again.body.approval.id}/approve`).send({});
        expect(own.body).toMatchObject({ status: 'SELF_APPROVED' });
        expect((await postRow(id)).status).toBe('SCHEDULED');
      } finally {
        await setApprovalSetting(false);
      }
    });

    it('an edit after the request drops it; a change behind the queue is caught at approval time', async () => {
      await setApprovalSetting(true);
      try {
        const connection = await newConnection('META_PAGE', 'edit');
        const id = await newPost(connection);
        const first = await schedule(id, inHours(1));
        expect(first.body.status).toBe('PENDING_APPROVAL');
        const edited = await as(marketingToken).patch(`/platform/marketing/social-posts/${id}`).send({ text: `${LABEL} yeni metin` });
        expect(edited.status).toBe(200);
        expect(edited.body).toMatchObject({ status: 'DRAFT', text: `${LABEL} yeni metin` });
        expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: first.body.approval.id } })).status).toBe('CANCELLED');
        expect((await as(superAdminToken).post(`/platform/marketing/approvals/${first.body.approval.id}/approve`).send({})).body.code).toBe('APPROVAL_NOT_PENDING');

        const second = await schedule(id, inHours(1));
        await prisma.socialPost.update({ where: { id }, data: { text: `${LABEL} sessizce degisti` } });
        const stale = await as(superAdminToken).post(`/platform/marketing/approvals/${second.body.approval.id}/approve`).send({});
        expect(stale.status).toBe(409);
        expect(stale.body.code).toBe('APPROVAL_CONTENT_CHANGED');
        expect((await postRow(id)).status).toBe('DRAFT');
        expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: second.body.approval.id } })).status).toBe('CANCELLED');
      } finally {
        await setApprovalSetting(false);
      }
    });

    it('an edit of a self-approved schedule drops the approval, and cancelling stops it for good', async () => {
      await setApprovalSetting(false);
      const connection = await newConnection('META_PAGE', 'cancel');
      const id = await newPost(connection);
      const scheduled = await schedule(id, inHours(1));
      expect(scheduled.body.status).toBe('SCHEDULED');
      const moved = await as(marketingToken).patch(`/platform/marketing/social-posts/${id}`).send({ scheduledAt: inHours(3).toISOString() });
      expect(moved.body).toMatchObject({ status: 'DRAFT' });
      expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: scheduled.body.approval.id } })).status).toBe('CANCELLED');
      // The language is not part of what an approval is bound to.
      const again = await schedule(id, inHours(1));
      const relabelled = await as(marketingToken).patch(`/platform/marketing/social-posts/${id}`).send({ locale: 'en' });
      expect(relabelled.body.status).toBe('SCHEDULED');
      expect(again.body.approval.status).toBe('SELF_APPROVED');

      const cancelled = await as(marketingToken).post(`/platform/marketing/social-posts/${id}/cancel`).send({});
      expect(cancelled.body.status).toBe('CANCELLED');
      expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: again.body.approval.id } })).status).toBe('CANCELLED');
      await runScheduler(inHours(2));
      expect((await postRow(id)).status).toBe('CANCELLED');
      expect((await as(marketingToken).delete(`/platform/marketing/social-posts/${id}`)).status).toBe(200);
      expect((await as(marketingToken).get(`/platform/marketing/social-posts/${id}`)).status).toBe(404);
    });
  });

  describe('provider outcomes', () => {
    it('an exhausted Instagram quota answers with the stable error and keeps the post SCHEDULED', async () => {
      await setApprovalSetting(false);
      const connection = await newConnection('INSTAGRAM', 'quota', 'EAAB-FAKE_QUOTA-token');
      const id = await newPost(connection, { mediaUrls: ['https://example.com/photo.jpg'] });
      const now = await as(marketingToken).post(`/platform/marketing/social-posts/${id}/publish-now`).send({});
      expect(now.status).toBe(409);
      expect(now.body.code).toBe('SOCIAL_QUOTA_EXHAUSTED');
      const held = await postRow(id);
      expect(held.status).toBe('SCHEDULED');
      expect(held.lastError).toBe('SOCIAL_QUOTA_EXHAUSTED');
      expect(held.attemptCount).toBe(0);
      expect(held.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

      // The heartbeat before the retry time leaves it alone; after it, it tries again and keeps waiting (no retry is spent).
      await runScheduler(new Date(Date.now() + 5 * MINUTE));
      expect((await postRow(id)).status).toBe('SCHEDULED');
      const later = await runScheduler(new Date(Date.now() + HOUR));
      expect(later.socialPublishing.deferred).toBeGreaterThanOrEqual(1);
      const after = await postRow(id);
      expect(after).toMatchObject({ status: 'SCHEDULED', attemptCount: 0, externalPostId: null });
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, entityId: id, action: 'social.post.deferred' } })).toBeGreaterThanOrEqual(2);
    });

    it('a 4xx answer marks the post FAILED with the reason, and editing it makes it a draft again', async () => {
      await setApprovalSetting(false);
      const connection = await newConnection('META_PAGE', 'fail4', 'EAAB-FAKE_4XX-token');
      const id = await newPost(connection);
      const res = await as(marketingToken).post(`/platform/marketing/social-posts/${id}/publish-now`).send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'FAILED' });
      expect(res.body.lastError).toContain('Fake 400');
      expect(res.body.lastError).not.toContain('FAKE_4XX-token');
      expect((await postRow(id)).attemptCount).toBe(1);
      expect((await prisma.socialConnection.findUniqueOrThrow({ where: { id: connection } })).status).toBe('CONNECTED');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { studioId: PLATFORM, entityId: id, action: 'social.post.failed' } });
      expect(audit.metadata).toMatchObject({ provider: 'META_PAGE', retryable: false });

      const fixed = await as(marketingToken).patch(`/platform/marketing/social-posts/${id}`).send({ text: `${LABEL} duzeltilmis` });
      expect(fixed.body).toMatchObject({ status: 'DRAFT', lastError: null });
    });

    it('a 5xx answer is retried with backoff and ends FAILED after the last step', async () => {
      await setApprovalSetting(false);
      const connection = await newConnection('META_PAGE', 'fail5', 'EAAB-FAKE_5XX-token');
      const id = await newPost(connection);
      expect((await schedule(id, inHours(1))).body.status).toBe('SCHEDULED');
      const start = inHours(2);
      const expectedDelays = [1, 5, 15, 60];
      let now = start;
      for (const [index, minutes] of expectedDelays.entries()) {
        await runScheduler(now);
        const row = await postRow(id);
        expect(row.status).toBe('SCHEDULED');
        expect(row.attemptCount).toBe(index + 1);
        expect(row.lastError).toContain('Fake 503');
        expect(row.nextAttemptAt!.getTime()).toBe(now.getTime() + minutes * MINUTE);
        // Too early: the same run does nothing.
        await runScheduler(new Date(now.getTime() + 30_000));
        expect((await postRow(id)).attemptCount).toBe(index + 1);
        now = new Date(now.getTime() + minutes * MINUTE + 1000);
      }
      await runScheduler(now);
      const failed = await postRow(id);
      expect(failed).toMatchObject({ status: 'FAILED', attemptCount: 5, nextAttemptAt: null });
      expect(failed.lastError).toContain('Fake 503');
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, entityId: id, action: 'social.post.retry' } })).toBe(4);
    });
  });

  describe('access', () => {
    it('lists and reads with view only, refuses writes without manage and sends without send', async () => {
      await setApprovalSetting(false);
      const connection = await newConnection('META_PAGE', 'access');
      const id = await newPost(connection);
      expect((await as(viewerToken).get('/platform/marketing/social-posts')).status).toBe(200);
      const pickable = await as(viewerToken).get('/platform/marketing/social-posts/connections');
      expect(pickable.status).toBe(200);
      expect(pickable.body.find((c: { id: string }) => c.id === connection)).toMatchObject({ credentialPreview: '****7788' });
      expect(JSON.stringify(pickable.body)).not.toContain(TOKEN);
      expect((await as(ownerToken).get('/platform/marketing/social-posts/connections')).status).toBe(403);
      expect((await as(viewerToken).get(`/platform/marketing/social-posts/${id}`)).status).toBe(200);
      const filtered = await as(viewerToken).get(`/platform/marketing/social-posts?status=DRAFT&connectionId=${connection}`);
      expect(filtered.body.items.map((p: { id: string }) => p.id)).toEqual([id]);
      expect((await as(viewerToken).get('/platform/marketing/social-posts?status=NOPE')).status).toBe(400);
      expect((await as(viewerToken).post('/platform/marketing/social-posts').send({ connectionId: connection, locale: 'tr', text: 'x' })).status).toBe(403);
      expect((await as(viewerToken).patch(`/platform/marketing/social-posts/${id}`).send({ text: 'x' })).status).toBe(403);
      expect((await as(viewerToken).delete(`/platform/marketing/social-posts/${id}`)).status).toBe(403);
      expect((await schedule(id, inHours(1), viewerToken)).status).toBe(403);
      expect((await as(viewerToken).post(`/platform/marketing/social-posts/${id}/cancel`).send({})).status).toBe(403);
    });

    it('is closed to a tenant owner and to anonymous callers, and unknown ids are 404', async () => {
      expect((await as(ownerToken).get('/platform/marketing/social-posts')).status).toBe(403);
      expect((await request(server).get('/platform/marketing/social-posts')).status).toBe(401);
      expect((await as(marketingToken).get('/platform/marketing/social-posts/00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await as(marketingToken).get('/platform/marketing/social-posts/not-a-uuid')).status).toBe(400);
      const foreign = await prisma.socialPost.findFirst({ where: { studioId: { not: PLATFORM } } });
      expect(foreign).toBeNull();
    });

    it('does not let a connection with active posts go', async () => {
      await setApprovalSetting(false);
      const connection = await newConnection('META_PAGE', 'inuse');
      const id = await newPost(connection);
      expect((await schedule(id, inHours(1))).body.status).toBe('SCHEDULED');
      const blocked = await as(marketingToken).delete(`/platform/integrations/social/${connection}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('SOCIAL_CONNECTION_IN_USE');
      expect((await as(marketingToken).post(`/platform/marketing/social-posts/${id}/cancel`).send({})).status).toBe(200);
      expect((await as(marketingToken).delete(`/platform/integrations/social/${connection}`)).status).toBe(200);
    });
  });
});
