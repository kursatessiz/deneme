import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { Prisma, PrismaClient } from '@platform/database';
import { normalizePhone } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * M3b marketing approvals (docs/PAZARLAMA_MODULU.md 6.1, 6.2): a platform
 * campaign goes out only with a self-approval (inside the thresholds) or a
 * super admin approval bound to its content; four eyes; invalidation after
 * a template change; US SMS always needs approval; pause blocks sending;
 * expiry; the super admin settings screen is audit logged; other tenants
 * keep scheduling directly. Everything created here is removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const ZEN_OWNER_PHONE = '+905321000002';
const PREFIX = '+90539888';
const US_PHONE = '+12025550187';
const MINUTE = 60_000;

/** An IANA zone where it is currently around noon, so commercial sends are never in quiet hours. */
function daytimeZone(): string {
  const offset = 12 - new Date().getUTCHours();
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

describe('Marketing approvals (M3b) e2e', () => {
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
  let marketing2Token: string;
  let viewerToken: string;
  let previousMfaPolicy: boolean | undefined;
  let previousStudio: { address: string | null; messagingSettings: Prisma.JsonValue };
  let walletExisted = false;
  let previousWallet = 0;
  let segmentA: string;
  let segmentUs: string;
  const templateKey = `M3B_SMS_${runId}`;
  const contactIds: string[] = [];
  const campaignIds: string[] = [];
  const segmentIds: string[] = [];

  const marketingPhone = normalizePhone(`0535${runId}`)!;
  const marketing2Phone = normalizePhone(`0534${runId}`)!;
  const viewerPhone = normalizePhone(`0533${runId}`)!;
  const viewerRoleKey = `m3b_viewer_${runId}`;

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`),
  });
  const tenant = (token: string, studioId: string) => ({
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const runScheduler = (now: Date) => as(superAdminToken).post('/admin/scheduler/run').send({ now: now.toISOString() });

  async function newCampaign(name: string, segmentId: string): Promise<string> {
    const res = await tenant(superAdminToken, PLATFORM)
      .post(`/studios/${PLATFORM}/campaigns`)
      .send({ name: `M3b e2e ${name}`, segmentId, channel: 'SMS', templateKey });
    expect(res.status).toBe(201);
    campaignIds.push(res.body.id);
    return res.body.id as string;
  }
  const requestApproval = (token: string, campaignId: string, body: Record<string, unknown> = {}) =>
    as(token).post(`/platform/marketing/campaigns/${campaignId}/request-approval`).send(body);
  const campaignRow = (id: string) => prisma.campaign.findUniqueOrThrow({ where: { id } });
  const sentCount = (campaignId: string) => prisma.campaignRecipient.count({ where: { campaignId, status: 'SENT' } });

  async function makeContact(n: number, phone: string, countryCode: string): Promise<string> {
    const contact = await prisma.contact.create({
      data: {
        studioId: PLATFORM,
        firstName: `M3b${n}`,
        lastName: 'M3bMarker',
        phone,
        countryCode,
        timezone: daytimeZone(),
        locale: 'tr',
        lifecycleStage: 'LEAD',
      },
    });
    await prisma.contactConsent.create({ data: { studioId: PLATFORM, contactId: contact.id, channel: 'SMS', status: 'GRANTED', source: 'e2e', grantedAt: new Date() } });
    contactIds.push(contact.id);
    return contact.id;
  }

  async function staticSegment(name: string, members: string[]): Promise<string> {
    const seg = await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/segments`).send({ name: `M3b e2e ${name}`, kind: 'STATIC' });
    expect(seg.status).toBe(201);
    segmentIds.push(seg.body.id);
    const add = await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/segments/${seg.body.id}/members`).send({ add: members });
    expect(add.status).toBe(201);
    return seg.body.id as string;
  }

  async function cleanup(): Promise<void> {
    const campaigns = await prisma.campaign.findMany({ where: { studioId: PLATFORM, name: { startsWith: 'M3b e2e' } }, select: { id: true } });
    const ids = [...new Set([...campaigns.map((c) => c.id), ...campaignIds])];
    const contacts = await prisma.contact.findMany({ where: { studioId: PLATFORM, lastName: 'M3bMarker' }, select: { id: true } });
    const cids = contacts.map((c) => c.id);
    await prisma.approvalRequest.deleteMany({ where: { studioId: PLATFORM, targetId: { in: ids } } });
    await prisma.notificationLog.deleteMany({
      where: { OR: [{ campaignId: { in: ids } }, { contactId: { in: cids } }, { studioId: PLATFORM, type: { startsWith: 'MARKETING_APPROVAL' }, createdAt: { gte: startedAt } }] },
    });
    await prisma.campaign.deleteMany({ where: { id: { in: ids } } });
    await prisma.segment.deleteMany({ where: { studioId: PLATFORM, name: { startsWith: 'M3b e2e' } } });
    await prisma.contact.deleteMany({ where: { id: { in: cids } } });
    await prisma.messageTemplate.deleteMany({ where: { studioId: PLATFORM, key: { startsWith: 'M3B_' } } });
    await prisma.marketingSettings.deleteMany({ where: { studioId: PLATFORM } });
    await prisma.auditLog.deleteMany({
      where: { studioId: PLATFORM, createdAt: { gte: startedAt }, OR: [{ action: { startsWith: 'marketing.approval.' } }, { action: { startsWith: 'marketing.campaign.' } }, { action: 'marketing.settings.updated' }] },
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    const platform = await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } });
    PLATFORM = platform.id;
    previousStudio = { address: platform.address, messagingSettings: platform.messagingSettings };
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    await cleanup();

    // A generous frequency cap: several campaigns reach the same contacts today.
    await prisma.studio.update({ where: { id: PLATFORM }, data: { messagingSettings: { frequencyCap: { perDay: 50, perWeek: 200 } }, address: 'M3b e2e adres 1' } });
    const wallet = await prisma.smsWallet.findUnique({ where: { studioId: PLATFORM } });
    walletExisted = Boolean(wallet);
    previousWallet = wallet?.balance ?? 0;
    await prisma.smsWallet.upsert({ where: { studioId: PLATFORM }, create: { studioId: PLATFORM, balance: 1000 }, update: { balance: 1000 } });
    await prisma.messageTemplate.create({
      data: {
        studioId: PLATFORM,
        key: templateKey,
        channel: 'SMS',
        locale: 'tr',
        body: 'Merhaba {firstName}, M3b deneme mesaji. Cikis icin RET yazin.',
        isTransactional: false,
        isActive: true,
      },
    });

    const previous = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
    previousMfaPolicy = previous?.require2faForPlatformRoles;
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', require2faForPlatformRoles: false }, update: { require2faForPlatformRoles: false } });
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const marketingRole = await prisma.platformRoleTemplate.findUniqueOrThrow({ where: { key: 'marketing_admin' } });
    const viewerRole = await prisma.platformRoleTemplate.create({
      data: { key: viewerRoleKey, name: 'M3b salt okunur', permissions: { create: [{ permissionKey: 'platform.marketing.view' }] } },
    });
    const marketing = await prisma.user.create({ data: { phone: marketingPhone, firstName: 'Pazarlama', lastName: 'Talep', passwordHash, phoneVerifiedAt: new Date() } });
    const marketing2 = await prisma.user.create({ data: { phone: marketing2Phone, firstName: 'Pazarlama', lastName: 'Diger', passwordHash, phoneVerifiedAt: new Date() } });
    const viewer = await prisma.user.create({ data: { phone: viewerPhone, firstName: 'Salt', lastName: 'Okur', passwordHash, phoneVerifiedAt: new Date() } });
    marketingUserId = marketing.id;
    await prisma.platformMembership.create({ data: { userId: marketing.id, roleTemplateId: marketingRole.id, status: 'ACTIVE', activatedAt: new Date() } });
    await prisma.platformMembership.create({ data: { userId: marketing2.id, roleTemplateId: marketingRole.id, status: 'ACTIVE', activatedAt: new Date() } });
    await prisma.platformMembership.create({ data: { userId: viewer.id, roleTemplateId: viewerRole.id, status: 'ACTIVE', activatedAt: new Date() } });

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    superAdminId = (await prisma.user.findUniqueOrThrow({ where: { phone: SUPER_ADMIN_PHONE } })).id;
    ownerToken = await login(ZEN_OWNER_PHONE);
    marketingToken = await login(marketingPhone);
    marketing2Token = await login(marketing2Phone);
    viewerToken = await login(viewerPhone);

    const tr: string[] = [];
    for (let i = 0; i < 5; i += 1) tr.push(await makeContact(i, `${PREFIX}${String(i).padStart(4, '0')}`, 'TR'));
    segmentA = await staticSegment('A', tr);
    segmentUs = await staticSegment('US', [await makeContact(9, US_PHONE, 'US')]);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.studio.update({
      where: { id: PLATFORM },
      data: { address: previousStudio.address, messagingSettings: (previousStudio.messagingSettings ?? {}) as Prisma.InputJsonValue },
    });
    if (walletExisted) await prisma.smsWallet.update({ where: { studioId: PLATFORM }, data: { balance: previousWallet } });
    else await prisma.smsWallet.deleteMany({ where: { studioId: PLATFORM } });
    const users = await prisma.user.findMany({ where: { phone: { in: [marketingPhone, marketing2Phone, viewerPhone] } }, select: { id: true } });
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

  describe('settings (super admin only, audit logged)', () => {
    it('returns the defaults and refuses everyone but the super admin', async () => {
      const view = await as(superAdminToken).get('/admin/marketing/settings');
      expect(view.status).toBe(200);
      expect(view.body.settings).toMatchObject({ selfApproveEmailMax: 1000, selfApproveSmsMax: 100, selfApproveSmsCredits: 100, approvalTtlHours: 72, updatedAt: null });
      expect(view.body.recipients.some((r: { userId: string }) => r.userId === marketingUserId)).toBe(true);
      for (const token of [marketingToken, ownerToken, viewerToken]) {
        expect((await as(token).get('/admin/marketing/settings')).status).toBe(403);
        expect((await as(token).patch('/admin/marketing/settings').send({ selfApproveSmsMax: 5 })).status).toBe(403);
      }
    });

    it('validates and audit logs every change', async () => {
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ selfApproveSmsMax: -1 })).status).toBe(400);
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ monthlyAdSpendCaps: { eur: '1' } })).status).toBe(400);
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ weeklySummaryRecipients: [contactIds[0]] })).status).toBe(400);
      const res = await as(superAdminToken)
        .patch('/admin/marketing/settings')
        .send({ monthlyAdSpendCaps: { EUR: '1500.00', USD: '2000' }, weeklySummaryEnabled: true, weeklySummaryRecipients: [marketingUserId], approvalTtlHours: 48 });
      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject({ monthlyAdSpendCaps: { EUR: '1500.00', USD: '2000' }, weeklySummaryEnabled: true, approvalTtlHours: 48 });
      const audit = await prisma.auditLog.findFirst({ where: { studioId: PLATFORM, action: 'marketing.settings.updated', userId: superAdminId }, orderBy: { createdAt: 'desc' } });
      expect(audit?.metadata).toMatchObject({ changes: { approvalTtlHours: { from: 72, to: 48 }, weeklySummaryEnabled: { from: false, to: true } } });
      // Back to the default TTL for the rest of the suite.
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ approvalTtlHours: 72 })).status).toBe(200);
    });
  });

  describe('approval flow', () => {
    it('a first-time segment waits for a super admin, cannot be scheduled directly, and sends once approved', async () => {
      const id = await newCampaign('ilk', segmentA);
      const direct = await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/campaigns/${id}/schedule`).send({});
      expect(direct.status).toBe(409);
      expect(direct.body.code).toBe('CAMPAIGN_APPROVAL_REQUIRED');

      const req = await requestApproval(marketingToken, id);
      expect(req.status).toBe(200);
      expect(req.body.campaignStatus).toBe('PENDING_APPROVAL');
      expect(req.body.request).toMatchObject({ status: 'PENDING', canDecide: false, canCancel: true });
      expect(req.body.request.summary.reasons).toEqual(expect.arrayContaining(['FIRST_TIME_SEGMENT', 'NEW_REGION']));
      expect(req.body.request.summary).toMatchObject({ audience: { total: 5 }, countries: { TR: 5 }, regions: { TR: 5 }, cost: { smsCredits: 5, byCurrency: {} } });
      const requestId = req.body.request.id as string;

      // Super admins are told (in-app); nothing goes out before the decision.
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM, userId: superAdminId, channel: 'IN_APP', type: 'MARKETING_APPROVAL_REQUESTED' } })).toBeGreaterThan(0);
      expect((await runScheduler(new Date(Date.now() + MINUTE))).status).toBe(201);
      expect((await campaignRow(id)).status).toBe('PENDING_APPROVAL');
      expect(await sentCount(id)).toBe(0);

      // The requester (not a super admin) cannot approve their own request; neither can the viewer.
      expect((await as(marketingToken).post(`/platform/marketing/approvals/${requestId}/approve`).send({})).status).toBe(403);
      expect((await as(viewerToken).post(`/platform/marketing/approvals/${requestId}/approve`).send({})).status).toBe(403);
      const list = await as(viewerToken).get('/platform/marketing/approvals?status=PENDING');
      expect(list.status).toBe(200);
      expect(list.body.items.some((i: { id: string }) => i.id === requestId)).toBe(true);
      expect((await as(ownerToken).get('/platform/marketing/approvals')).status).toBe(403);

      const approved = await as(superAdminToken).post(`/platform/marketing/approvals/${requestId}/approve`).send({ note: 'Uygun' });
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', decidedBy: { id: superAdminId }, decisionNote: 'Uygun' });
      expect((await campaignRow(id)).status).toBe('SCHEDULED');
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM, userId: marketingUserId, channel: 'IN_APP', type: 'MARKETING_APPROVAL_APPROVED' } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.approval.approved', entityId: requestId } })).toBe(1);

      expect((await runScheduler(new Date(Date.now() + MINUTE))).status).toBe(201);
      expect((await campaignRow(id)).status).toBe('SENT');
      expect(await sentCount(id)).toBe(5);
    });

    it('under the thresholds the requester self-approves and it sends', async () => {
      const id = await newCampaign('kendi onayi', segmentA);
      const req = await requestApproval(marketingToken, id);
      expect(req.status).toBe(200);
      expect(req.body.campaignStatus).toBe('SCHEDULED');
      expect(req.body.request).toMatchObject({ status: 'SELF_APPROVED', decidedBy: { id: marketingUserId } });
      expect(req.body.request.summary).toMatchObject({ selfApprovable: true, reasons: [], segmentApprovedBefore: true, newCountries: [] });
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.approval.self_approved', entityId: req.body.request.id } })).toBe(1);

      expect((await runScheduler(new Date(Date.now() + MINUTE))).status).toBe(201);
      expect((await campaignRow(id)).status).toBe('SENT');
      expect(await sentCount(id)).toBe(5);
    });

    it('over the threshold it cannot be sent without a super admin; a rejection needs a note and returns it to draft', async () => {
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ selfApproveSmsMax: 2 })).status).toBe(200);
      const id = await newCampaign('esik ustu', segmentA);
      const req = await requestApproval(marketingToken, id);
      expect(req.body.campaignStatus).toBe('PENDING_APPROVAL');
      expect(req.body.request.summary.reasons).toEqual(['SMS_OVER_THRESHOLD']);
      const direct = await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/campaigns/${id}/schedule`).send({});
      expect(direct.status).toBe(409);
      expect(direct.body.code).toBe('CAMPAIGN_APPROVAL_REQUIRED');
      expect((await runScheduler(new Date(Date.now() + MINUTE))).status).toBe(201);
      expect(await sentCount(id)).toBe(0);

      expect((await as(superAdminToken).post(`/platform/marketing/approvals/${req.body.request.id}/reject`).send({})).status).toBe(400);
      const rejected = await as(superAdminToken).post(`/platform/marketing/approvals/${req.body.request.id}/reject`).send({ note: 'Kitle fazla genis' });
      expect(rejected.status).toBe(200);
      expect(rejected.body).toMatchObject({ status: 'REJECTED', decisionNote: 'Kitle fazla genis' });
      expect((await campaignRow(id)).status).toBe('DRAFT');
      expect(await prisma.notificationLog.count({ where: { userId: marketingUserId, channel: 'IN_APP', type: 'MARKETING_APPROVAL_REJECTED' } })).toBe(1);
      // A decided request cannot be decided again.
      const again = await as(superAdminToken).post(`/platform/marketing/approvals/${req.body.request.id}/approve`).send({});
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('APPROVAL_NOT_PENDING');
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ selfApproveSmsMax: 100 })).status).toBe(200);
    });

    it('a template change after the approval invalidates it and nothing is sent', async () => {
      const id = await newCampaign('sablon degisti', segmentA);
      const req = await requestApproval(marketingToken, id, { scheduledAt: new Date(Date.now() + 2 * MINUTE).toISOString() });
      expect(req.body.request.status).toBe('SELF_APPROVED');
      const oldId = req.body.request.id as string;

      await prisma.messageTemplate.updateMany({ where: { studioId: PLATFORM, key: templateKey }, data: { body: 'Merhaba {firstName}, degisen metin. Cikis icin RET yazin.' } });
      expect((await runScheduler(new Date(Date.now() + 3 * MINUTE))).status).toBe(201);

      const campaign = await campaignRow(id);
      expect(campaign.status).toBe('PENDING_APPROVAL');
      expect(campaign.approvalRequestId).not.toBe(oldId);
      expect(await sentCount(id)).toBe(0);
      const old = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: oldId } });
      expect(old.status).toBe('CANCELLED');
      expect(old.summary).toMatchObject({ invalidated: { reason: 'CONTENT_CHANGED', replacedByRequestId: campaign.approvalRequestId } });
      const next = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: campaign.approvalRequestId! } });
      expect(next.status).toBe('PENDING');

      // A change while the request waits: the approval is refused and replaced again.
      await prisma.messageTemplate.updateMany({ where: { studioId: PLATFORM, key: templateKey }, data: { body: 'Merhaba {firstName}, ucuncu metin. Cikis icin RET yazin.' } });
      const approve = await as(superAdminToken).post(`/platform/marketing/approvals/${next.id}/approve`).send({});
      expect(approve.status).toBe(409);
      expect(approve.body.code).toBe('APPROVAL_CONTENT_CHANGED');
      const after = await campaignRow(id);
      expect(after.status).toBe('PENDING_APPROVAL');
      expect(after.approvalRequestId).not.toBe(next.id);
      expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('CANCELLED');
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.approval.invalidated', createdAt: { gte: startedAt } } })).toBeGreaterThanOrEqual(2);
      expect((await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/campaigns/${id}/cancel`)).status).toBe(201);
      expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: after.approvalRequestId! } })).status).toBe('CANCELLED');
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.approval.cancelled', entityId: after.approvalRequestId!, userId: superAdminId } })).toBe(1);
    });

    it('SMS to a United States recipient always needs a super admin; only the requester or a super admin withdraws it', async () => {
      const id = await newCampaign('abd', segmentUs);
      const req = await requestApproval(marketingToken, id);
      expect(req.body.campaignStatus).toBe('PENDING_APPROVAL');
      expect(req.body.request.summary.reasons).toEqual(expect.arrayContaining(['US_SMS_RECIPIENT']));
      expect(req.body.request.summary.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'US_SMS_RECIPIENTS', severity: 'warning', count: 1 })]));
      expect(req.body.request.summary.regions).toMatchObject({ US: 1 });

      const other = await as(marketing2Token).post(`/platform/marketing/approvals/${req.body.request.id}/cancel`).send({});
      expect(other.status).toBe(403);
      expect(other.body.code).toBe('APPROVAL_CANCEL_FORBIDDEN');
      const own = await as(marketingToken).post(`/platform/marketing/approvals/${req.body.request.id}/cancel`).send({});
      expect(own.status).toBe(200);
      expect(own.body.status).toBe('CANCELLED');
      expect((await campaignRow(id)).status).toBe('DRAFT');
    });

    it('a super admin may approve their own request, recorded as SELF_APPROVED', async () => {
      const segment = await staticSegment('super admin', contactIds.slice(0, 2));
      const id = await newCampaign('super admin', segment);
      const req = await requestApproval(superAdminToken, id);
      expect(req.body.request.status).toBe('PENDING');
      expect(req.body.request.summary.reasons).toContain('FIRST_TIME_SEGMENT');
      const own = await as(superAdminToken).post(`/platform/marketing/approvals/${req.body.request.id}/approve`).send({});
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({ status: 'SELF_APPROVED', decidedBy: { id: superAdminId }, summary: { selfApprovedBySuperAdmin: true } });
      expect(await prisma.auditLog.count({ where: { action: 'marketing.approval.self_approved_by_super_admin', entityId: req.body.request.id } })).toBe(1);
      expect((await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/campaigns/${id}/cancel`)).status).toBe(201);
    });

    it('a pending request expires after its TTL and the campaign returns to draft', async () => {
      const segment = await staticSegment('sure', contactIds.slice(0, 3));
      const id = await newCampaign('sure', segment);
      const req = await requestApproval(marketingToken, id);
      expect(req.body.request.status).toBe('PENDING');
      const created = new Date(req.body.request.createdAt).getTime();
      expect(new Date(req.body.request.expiresAt).getTime() - created).toBe(72 * 60 * MINUTE);
      await prisma.approvalRequest.update({ where: { id: req.body.request.id }, data: { expiresAt: new Date(Date.now() - MINUTE) } });
      expect((await runScheduler(new Date())).status).toBe(201);
      expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.body.request.id } })).status).toBe('EXPIRED');
      expect((await campaignRow(id)).status).toBe('DRAFT');
      const late = await as(superAdminToken).post(`/platform/marketing/approvals/${req.body.request.id}/approve`).send({});
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('APPROVAL_NOT_PENDING');
    });
  });

  describe('pause and resume', () => {
    it('a paused campaign never sends until it is resumed', async () => {
      const id = await newCampaign('duraklat', segmentA);
      const req = await requestApproval(marketingToken, id, { scheduledAt: new Date(Date.now() + 2 * MINUTE).toISOString() });
      expect(req.body.request.status).toBe('SELF_APPROVED');

      expect((await as(viewerToken).post(`/platform/marketing/campaigns/${id}/pause`)).status).toBe(403);
      const paused = await as(marketingToken).post(`/platform/marketing/campaigns/${id}/pause`);
      expect(paused.status).toBe(200);
      expect(paused.body.status).toBe('PAUSED');
      const twice = await as(marketingToken).post(`/platform/marketing/campaigns/${id}/pause`);
      expect(twice.status).toBe(409);
      expect(twice.body.code).toBe('CAMPAIGN_NOT_PAUSABLE');

      expect((await runScheduler(new Date(Date.now() + 3 * MINUTE))).status).toBe(201);
      expect((await campaignRow(id)).status).toBe('PAUSED');
      expect(await sentCount(id)).toBe(0);

      const resumed = await as(superAdminToken).post(`/platform/marketing/campaigns/${id}/resume`);
      expect(resumed.status).toBe(200);
      expect(resumed.body.status).toBe('SCHEDULED');
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, entityId: id, action: { in: ['marketing.campaign.paused', 'marketing.campaign.resumed'] } } })).toBe(2);
      expect((await runScheduler(new Date(Date.now() + 3 * MINUTE))).status).toBe(201);
      expect((await campaignRow(id)).status).toBe('SENT');
      expect(await sentCount(id)).toBe(5);
    });
  });

  describe('other tenants', () => {
    it('keep scheduling campaigns directly, without any approval', async () => {
      const segment = await tenant(ownerToken, ZEN).post(`/studios/${ZEN}/segments`).send({ name: `M3b e2e zen ${runId}`, kind: 'STATIC' });
      expect(segment.status).toBe(201);
      const create = await tenant(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns`).send({ name: 'M3b e2e zen', segmentId: segment.body.id, channel: 'SMS', templateKey: 'WIN_BACK' });
      expect(create.status).toBe(201);
      const scheduled = await tenant(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${create.body.id}/schedule`).send({ scheduledAt: new Date(Date.now() + 60 * MINUTE).toISOString() });
      expect(scheduled.status).toBe(201);
      expect(scheduled.body).toMatchObject({ status: 'SCHEDULED', approvalRequestId: null });
      expect((await tenant(ownerToken, ZEN).post(`/studios/${ZEN}/campaigns/${create.body.id}/cancel`)).status).toBe(201);
      expect(await prisma.approvalRequest.count({ where: { studioId: ZEN } })).toBe(0);
      // The platform endpoints never act on another tenant's campaign.
      expect((await as(superAdminToken).post(`/platform/marketing/campaigns/${create.body.id}/request-approval`).send({})).status).toBe(404);
      await prisma.campaign.delete({ where: { id: create.body.id } });
      await prisma.segment.delete({ where: { id: segment.body.id } });
    });
  });
});
