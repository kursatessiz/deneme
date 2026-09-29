import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { Prisma, PrismaClient } from '@platform/database';
import { normalizePhone } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { AI_PROVIDER_ADAPTER } from '../../src/modules/ai/providers/ai-provider';
import { FakeAiAdapter } from '../../src/modules/ai/providers/fake-ai.adapter';
import { CampaignsService } from '../../src/modules/growth/campaigns/campaigns.service';
import { MarketingGuardsService } from '../../src/modules/growth/campaigns/marketing-guards.service';
import { MarketingInsightsService } from '../../src/modules/platform-marketing/insights/marketing-insights.service';

/**
 * M3d (docs/PAZARLAMA_MODULU.md 3.3, 6.2, 6.3): the weekly summary (one per
 * ISO week, idempotent), the e-mail deliverability fuse (auto-pause, one alert
 * per 24 hours per reason), the daily send caps with deferral, the ad spend
 * cap per currency, the real pending approval count on the dashboard and the
 * super admin audit view. The heartbeat steps are called on the services with
 * fixed instants (2030) so that the scheduler's other jobs never see a future
 * clock; one real scheduler run checks the wiring. The fake AI provider stands
 * in for the model. Everything created here is removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const ZEN_OWNER_PHONE = '+905321000002';
const API_KEY = 'sk-ant-api03-e2e-insights-key-value-0000ASDF';
const PREFIX = '+90539777';
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** An IANA zone where it is currently around noon, so the engine's real-clock quiet hours never hold a send. */
function daytimeZone(): string {
  const offset = 12 - new Date().getUTCHours();
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** A Monday: the week of 4-10 March 2030 is summarised, against 25 February - 3 March. */
const MONDAY = new Date('2030-03-11T06:00:00.000Z');

describe('Marketing insights and guards (M3d) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const fake = new FakeAiAdapter();
  const startedAt = new Date();
  const runId = Date.now().toString().slice(-7);

  let PLATFORM: string;
  let superAdminToken: string;
  let superAdminId: string;
  let ownerToken: string;
  let marketingToken: string;
  let marketingUserId: string;
  let viewerToken: string;
  let previousMfaPolicy: boolean | undefined;
  let previousStudio: { messagingSettings: Prisma.JsonValue };
  let walletExisted = false;
  let previousWallet = 0;
  let segmentId: string;
  let firstWeeklyMessages = '';
  let guards: MarketingGuardsService;
  let insights: MarketingInsightsService;
  let campaigns: CampaignsService;
  const templateKey = `M3D_SMS_${runId}`;
  const contactIds: string[] = [];
  const campaignIds: string[] = [];
  const marketingPhone = normalizePhone(`0535${runId}`)!;
  const viewerPhone = normalizePhone(`0533${runId}`)!;
  const viewerRoleKey = `m3d_viewer_${runId}`;

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`),
  });
  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const settings = (body: Record<string, unknown>) => as(superAdminToken).patch('/admin/marketing/settings').send(body);
  const weeklyRequests = () => fake.requests.filter((r) => (r.messages[r.messages.length - 1]?.content ?? '').includes('"task":"MARKETING_WEEKLY_SUMMARY"'));
  const insightRows = () => prisma.marketingInsight.findMany({ where: { studioId: PLATFORM }, orderBy: { periodStart: 'asc' } });
  const dashboard = async () => {
    const res = await as(superAdminToken).get('/platform/marketing/dashboard');
    expect(res.status).toBe(200);
    return res.body.health as {
      approvals: { available: boolean; pending: number };
      caps: { email: { sent: number; cap: number | null; source: string; warmupDay: number | null }; sms: { credits: number; cap: number | null }; deferredRecipients: number };
      autoPause: { active: boolean; pausedCampaigns: number; reasons: string[] };
      adSpendCaps: Array<{ currency: string; cap: string; spent: string; exceeded: boolean }>;
    };
  };
  const notices = (type: string, channel: 'IN_APP' | 'EMAIL' = 'IN_APP') => prisma.notificationLog.count({ where: { studioId: PLATFORM, userId: superAdminId, channel, type } });

  async function emailCampaign(name: string, status: 'SENDING' | 'SCHEDULED' | 'DRAFT', channel: 'EMAIL' | 'SMS' | null = 'EMAIL'): Promise<string> {
    const row = await prisma.campaign.create({
      data: { studioId: PLATFORM, name: `M3d e2e ${name}`, segmentId, channel, templateKey, status, ...(status === 'SCHEDULED' ? { scheduledAt: new Date('2031-01-01T00:00:00.000Z') } : {}) },
    });
    campaignIds.push(row.id);
    return row.id;
  }
  const campaignRow = (id: string) => prisma.campaign.findUniqueOrThrow({ where: { id } });

  /** E-mail log rows of the platform tenant: `ok` accepted ones plus the bounced and complained ones, all `at`. */
  async function emailLogs(at: Date, ok: number, bounced: number, complained = 0): Promise<void> {
    const base = { studioId: PLATFORM, channel: 'EMAIL' as const, type: 'M3D_E2E', subject: 'm3d-e2e', content: 'm3d-e2e', createdAt: at };
    await prisma.notificationLog.createMany({
      data: [
        ...Array.from({ length: ok }, () => ({ ...base, status: 'SENT' as const })),
        ...Array.from({ length: bounced }, () => ({ ...base, status: 'BOUNCED' as const, bouncedAt: at })),
        ...Array.from({ length: complained }, () => ({ ...base, status: 'COMPLAINED' as const, complainedAt: at })),
      ],
    });
  }

  async function cleanup(): Promise<void> {
    const rows = await prisma.campaign.findMany({ where: { studioId: PLATFORM, name: { startsWith: 'M3d e2e' } }, select: { id: true } });
    const ids = [...new Set([...rows.map((c) => c.id), ...campaignIds])];
    const contacts = await prisma.contact.findMany({ where: { studioId: PLATFORM, lastName: 'M3dMarker' }, select: { id: true } });
    const cids = contacts.map((c) => c.id);
    await prisma.notificationLog.deleteMany({
      where: {
        OR: [
          { campaignId: { in: ids } },
          { contactId: { in: cids } },
          { studioId: PLATFORM, type: 'M3D_E2E' },
          { studioId: PLATFORM, type: { in: ['MARKETING_WEEKLY_SUMMARY', 'MARKETING_EMAIL_FUSE_TRIPPED', 'MARKETING_AD_CAP_EXCEEDED'] }, createdAt: { gte: startedAt } },
        ],
      },
    });
    await prisma.campaign.deleteMany({ where: { id: { in: ids } } });
    await prisma.segment.deleteMany({ where: { studioId: PLATFORM, name: { startsWith: 'M3d e2e' } } });
    await prisma.contact.deleteMany({ where: { id: { in: cids } } });
    await prisma.messageTemplate.deleteMany({ where: { studioId: PLATFORM, key: { startsWith: 'M3D_' } } });
    await prisma.marketingInsight.deleteMany({ where: { studioId: PLATFORM } });
    await prisma.adSpendDaily.deleteMany({ where: { studioId: PLATFORM, externalId: { startsWith: 'm3d-e2e' } } });
    await prisma.approvalRequest.deleteMany({ where: { studioId: PLATFORM, summary: { path: ['m3dE2e'], equals: true } } });
    await prisma.emailSenderDomain.deleteMany({ where: { studioId: PLATFORM, domain: { startsWith: 'm3d-e2e' } } });
    await prisma.marketingSettings.deleteMany({ where: { studioId: PLATFORM } });
    await prisma.aiUsage.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { studioId: PLATFORM, action: { startsWith: 'marketing.' }, createdAt: { gte: startedAt } },
          { action: { startsWith: 'm3d.e2e' } },
        ],
      },
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER_ADAPTER)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    guards = app.get(MarketingGuardsService, { strict: false });
    insights = app.get(MarketingInsightsService, { strict: false });
    campaigns = app.get(CampaignsService, { strict: false });

    const platform = await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } });
    PLATFORM = platform.id;
    previousStudio = { messagingSettings: platform.messagingSettings };
    await cleanup();

    // A generous frequency cap, a wallet with credit and an SMS template for the cap scenario.
    await prisma.studio.update({ where: { id: PLATFORM }, data: { messagingSettings: { frequencyCap: { perDay: 50, perWeek: 200 } } } });
    const wallet = await prisma.smsWallet.findUnique({ where: { studioId: PLATFORM } });
    walletExisted = Boolean(wallet);
    previousWallet = wallet?.balance ?? 0;
    await prisma.smsWallet.upsert({ where: { studioId: PLATFORM }, create: { studioId: PLATFORM, balance: 1000 }, update: { balance: 1000 } });
    await prisma.messageTemplate.create({
      data: { studioId: PLATFORM, key: templateKey, channel: 'SMS', locale: 'tr', body: 'Merhaba {firstName}, M3d deneme mesaji. Cikis icin RET yazin.', isTransactional: false, isActive: true },
    });

    const previous = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
    previousMfaPolicy = previous?.require2faForPlatformRoles;
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', require2faForPlatformRoles: false }, update: { require2faForPlatformRoles: false } });
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const marketingRole = await prisma.platformRoleTemplate.findUniqueOrThrow({ where: { key: 'marketing_admin' } });
    const viewerRole = await prisma.platformRoleTemplate.create({ data: { key: viewerRoleKey, name: 'M3d salt okunur', permissions: { create: [{ permissionKey: 'platform.marketing.view' }] } } });
    const marketing = await prisma.user.create({ data: { phone: marketingPhone, firstName: 'Pazarlama', lastName: 'Ozet', passwordHash, phoneVerifiedAt: new Date() } });
    const viewer = await prisma.user.create({ data: { phone: viewerPhone, firstName: 'Salt', lastName: 'Okur', passwordHash, phoneVerifiedAt: new Date() } });
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
    await prisma.aiSettings.deleteMany({});
    await prisma.studio.update({ where: { id: PLATFORM }, data: { messagingSettings: (previousStudio.messagingSettings ?? {}) as Prisma.InputJsonValue } });
    if (walletExisted) await prisma.smsWallet.update({ where: { studioId: PLATFORM }, data: { balance: previousWallet } });
    else await prisma.smsWallet.deleteMany({ where: { studioId: PLATFORM } });
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

  beforeEach(() => fake.reset());

  it('sets up the AI key and a segment', async () => {
    const key = await request(server).put('/admin/ai/settings/key').set('Authorization', `Bearer ${superAdminToken}`).send({ apiKey: API_KEY });
    expect(key.status).toBe(200);
    const seg = await request(server)
      .post(`/studios/${PLATFORM}/segments`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('x-studio-id', PLATFORM)
      .send({ name: `M3d e2e segment ${runId}`, kind: 'STATIC' });
    expect(seg.status).toBe(201);
    segmentId = seg.body.id;
  });

  describe('weekly summary', () => {
    beforeAll(async () => {
      // Spend (not person data) in the summarised week and in the week before it, in USD.
      await prisma.adSpendDaily.createMany({
        data: [
          { studioId: PLATFORM, platform: 'META', level: 'CAMPAIGN', externalId: 'm3d-e2e-1', date: new Date('2030-03-05'), spendAmount: new Prisma.Decimal('120.00'), currency: 'USD' },
          { studioId: PLATFORM, platform: 'META', level: 'CAMPAIGN', externalId: 'm3d-e2e-1', date: new Date('2030-02-26'), spendAmount: new Prisma.Decimal('60.00'), currency: 'USD' },
          // The week of 18-24 March, for the budget scenario below.
          { studioId: PLATFORM, platform: 'META', level: 'CAMPAIGN', externalId: 'm3d-e2e-1', date: new Date('2030-03-19'), spendAmount: new Prisma.Decimal('30.00'), currency: 'USD' },
        ],
      });
    });

    it('does nothing while the setting is off', async () => {
      expect(await insights.runWeekly(MONDAY)).toEqual({ generated: false, skipped: 'DISABLED' });
      expect(await insightRows()).toHaveLength(0);
      expect(weeklyRequests()).toHaveLength(0);
    });

    it('generates exactly one insight on Monday and a second run (or a later day of the week) does not duplicate', async () => {
      expect((await settings({ weeklySummaryEnabled: true, weeklySummaryRecipients: [superAdminId] })).status).toBe(200);
      expect(await insights.runWeekly(MONDAY)).toEqual({ generated: true, skipped: null });
      expect(await insightRows()).toHaveLength(1);
      expect(weeklyRequests()).toHaveLength(1);
      firstWeeklyMessages = JSON.stringify(weeklyRequests()[0]?.messages);

      expect(await insights.runWeekly(MONDAY)).toEqual({ generated: false, skipped: 'EXISTS' });
      expect(await insights.runWeekly(new Date(MONDAY.getTime() + 2 * DAY + 5 * HOUR))).toEqual({ generated: false, skipped: 'EXISTS' });
      const rows = await insightRows();
      expect(rows).toHaveLength(1);
      // The model was asked once for the week, not once per heartbeat.
      expect(weeklyRequests()).toHaveLength(1);
      expect(rows[0]?.periodStart.toISOString().slice(0, 10)).toBe('2030-03-04');
      expect(rows[0]?.periodEnd.toISOString().slice(0, 10)).toBe('2030-03-10');
    });

    it('stores aggregate KPIs, a summary and 3-5 actions grounded in the supplied metrics, metered as marketing AI', async () => {
      const [row] = await insightRows();
      const kpis = row!.kpis as { metrics: Array<{ key: string; current: number | null; previous: number | null; changeRatio: number | null; currency: string | null }> };
      const spend = kpis.metrics.find((m) => m.key === 'spend:USD');
      expect(spend).toMatchObject({ current: 120, previous: 60, changeRatio: 1, currency: 'USD' });
      expect(row!.summary.length).toBeGreaterThan(0);
      const actions = row!.actions as Array<{ title: string; detail: string; kpiKey: string }>;
      expect(actions.length).toBeGreaterThanOrEqual(3);
      expect(actions.length).toBeLessThanOrEqual(5);
      const keys = new Set(kpis.metrics.map((m) => m.key));
      expect(actions.every((a) => keys.has(a.kpiKey))).toBe(true);
      // No person data anywhere in what was stored or sent to the model.
      expect(JSON.stringify(kpis)).not.toMatch(/@|\+\d{6,}/);
      expect(firstWeeklyMessages).toContain('MARKETING_WEEKLY_SUMMARY');
      expect(firstWeeklyMessages).not.toMatch(/@|\+\d{6,}/);

      const usage = await prisma.aiUsage.findMany({ where: { studioId: PLATFORM, task: 'MARKETING_WEEKLY_SUMMARY' } });
      expect(usage).toHaveLength(1);
      expect(row!.aiUsageId).toBe(usage[0]!.id);
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.insight.generated', entityId: row!.id } })).toBe(1);
    });

    it('e-mails the configured recipients through the transactional template', async () => {
      const logs = await prisma.notificationLog.findMany({ where: { studioId: PLATFORM, userId: superAdminId, channel: 'EMAIL', type: 'MARKETING_WEEKLY_SUMMARY' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.purpose).toBe('TRANSACTIONAL');
      // The money is formatted for the recipient, per currency.
      expect(logs[0]?.content).toMatch(/USD/);
    });

    it('lists insights for platform.marketing.view and refuses everyone else', async () => {
      const list = await as(viewerToken).get('/platform/marketing/insights?limit=5');
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ periodStart: '2030-03-04', periodEnd: '2030-03-10' });
      expect(list.body.items[0].actions.length).toBeGreaterThanOrEqual(3);
      expect(list.body.items[0].aiUsageId).toBeUndefined();
      expect((await as(marketingToken).get('/platform/marketing/insights')).status).toBe(200);
      expect((await as(ownerToken).get('/platform/marketing/insights')).status).toBe(403);
      expect((await request(server).get('/platform/marketing/insights')).status).toBe(401);
      expect((await as(viewerToken).get('/platform/marketing/insights?limit=0')).status).toBe(400);
    });

    it('generate-now is for the super admin: keeps an existing week, creates the next, force replaces in place', async () => {
      const body = { at: MONDAY.toISOString() };
      for (const token of [marketingToken, viewerToken, ownerToken]) {
        expect((await as(token).post('/admin/marketing/insights/generate').send(body)).status).toBe(403);
      }
      expect((await request(server).post('/admin/marketing/insights/generate').send(body)).status).toBe(401);
      expect((await as(superAdminToken).post('/admin/marketing/insights/generate').send({ unknown: true })).status).toBe(400);

      const kept = await as(superAdminToken).post('/admin/marketing/insights/generate').send(body);
      expect(kept.status).toBe(200);
      expect(kept.body.created).toBe(false);
      expect(await insightRows()).toHaveLength(1);

      const next = await as(superAdminToken).post('/admin/marketing/insights/generate').send({ at: new Date(MONDAY.getTime() + 7 * DAY).toISOString() });
      expect(next.status).toBe(200);
      expect(next.body).toMatchObject({ created: true, insight: { periodStart: '2030-03-11', periodEnd: '2030-03-17' } });
      // The manual path does not e-mail unless asked to.
      expect(await notices('MARKETING_WEEKLY_SUMMARY', 'EMAIL')).toBe(1);
      const again = await as(superAdminToken).post('/admin/marketing/insights/generate').send({ at: new Date(MONDAY.getTime() + 7 * DAY).toISOString(), force: true });
      expect(again.body.created).toBe(true);
      expect(await insightRows()).toHaveLength(2);
    });

    it('counts against the marketing AI budget: the daily cap answers 402 and the heartbeat waits instead of failing', async () => {
      expect((await settings({ aiDailyCapCents: 0 })).status).toBe(200);
      const later = new Date(MONDAY.getTime() + 14 * DAY);
      const res = await as(superAdminToken).post('/admin/marketing/insights/generate').send({ at: later.toISOString() });
      expect(res.status).toBe(402);
      expect(res.body.code).toBe('MARKETING_AI_DAILY_CAP_EXCEEDED');
      expect(await insights.runWeekly(later)).toEqual({ generated: false, skipped: 'AI_UNAVAILABLE' });
      expect(await insightRows()).toHaveLength(2);
      expect((await settings({ aiDailyCapCents: null })).status).toBe(200);
      expect(await insights.runWeekly(later)).toEqual({ generated: true, skipped: null });
      expect(await insightRows()).toHaveLength(3);
    });

    it('a quiet week is stored without a model call', async () => {
      const before = weeklyRequests().length;
      const quiet = await as(superAdminToken).post('/admin/marketing/insights/generate').send({ at: new Date('2032-03-01T00:00:00.000Z').toISOString() });
      expect(quiet.status).toBe(200);
      expect(quiet.body.insight.actions).toEqual([]);
      expect(quiet.body.insight.summary.length).toBeGreaterThan(0);
      expect(weeklyRequests().length).toBe(before);
    });
  });

  describe('e-mail deliverability fuse', () => {
    it('has no verdict without e-mail in the window (zero denominators)', async () => {
      const result = await guards.runFuse(new Date('2031-06-01T12:00:00.000Z'));
      expect(result).toMatchObject({ checked: true, tripped: [], pausedCampaigns: 0, alertsSent: 0 });
    });

    it('pauses every SENDING or SCHEDULED e-mail campaign over the bounce threshold, alerts once, leaves the rest alone', async () => {
      const now = new Date('2030-03-11T12:00:00.000Z');
      await emailLogs(new Date(now.getTime() - 2 * HOUR), 100, 5);
      const sending = await emailCampaign('sending email', 'SENDING');
      const scheduled = await emailCampaign('scheduled email', 'SCHEDULED');
      const noChannel = await emailCampaign('tenant order', 'SENDING', null);
      const sms = await emailCampaign('sms', 'SENDING', 'SMS');
      const draft = await emailCampaign('draft email', 'DRAFT');

      const result = await guards.runFuse(now);
      expect(result).toEqual({ checked: true, tripped: ['BOUNCE'], pausedCampaigns: 3, alertsSent: 1 });
      for (const id of [sending, scheduled, noChannel]) {
        expect(await campaignRow(id)).toMatchObject({ status: 'PAUSED', pauseReason: 'AUTO_BOUNCE' });
      }
      expect((await campaignRow(sms)).status).toBe('SENDING');
      expect((await campaignRow(draft)).status).toBe('DRAFT');
      const audit = await prisma.auditLog.findFirst({ where: { studioId: PLATFORM, action: 'marketing.campaign.auto_paused', entityId: sending } });
      expect(audit?.metadata).toMatchObject({ from: 'SENDING', reasons: ['BOUNCE'], reasonCode: 'AUTO_BOUNCE', sent: 105, bounced: 5 });
      expect(audit?.userId).toBeNull();

      // The super admin is told in-app and by e-mail, with the rate.
      expect(await notices('MARKETING_EMAIL_FUSE_TRIPPED')).toBe(1);
      expect(await notices('MARKETING_EMAIL_FUSE_TRIPPED', 'EMAIL')).toBe(1);
      const alert = await prisma.notificationLog.findFirstOrThrow({ where: { studioId: PLATFORM, userId: superAdminId, channel: 'IN_APP', type: 'MARKETING_EMAIL_FUSE_TRIPPED' } });
      expect(alert.content).toContain('%');

      // The dashboard shows the state; the campaign screen gets the reason.
      const health = await dashboard();
      expect(health.autoPause.active).toBe(true);
      expect(health.autoPause.reasons).toContain('BOUNCE');
      expect(health.autoPause.pausedCampaigns).toBeGreaterThanOrEqual(3);
      const detail = await request(server).get(`/studios/${PLATFORM}/campaigns/${sending}`).set('Authorization', `Bearer ${superAdminToken}`).set('x-studio-id', PLATFORM);
      expect(detail.body).toMatchObject({ status: 'PAUSED', pauseReason: 'AUTO_BOUNCE' });

      // Still over the threshold on the next check: nothing new to pause and no second alert within 24 hours.
      const again = await guards.runFuse(new Date(now.getTime() + 15 * 60_000));
      expect(again).toEqual({ checked: true, tripped: ['BOUNCE'], pausedCampaigns: 0, alertsSent: 0 });
      expect(await notices('MARKETING_EMAIL_FUSE_TRIPPED')).toBe(1);
    });

    it('a paused campaign never sends; resuming is manual and the fuse does not touch it once the rates recover', async () => {
      const now = new Date('2030-03-11T12:00:00.000Z');
      const paused = await prisma.campaign.findFirstOrThrow({ where: { studioId: PLATFORM, name: 'M3d e2e scheduled email' } });
      expect(paused.status).toBe('PAUSED');
      expect(await campaigns.processDue(now)).toBeDefined();
      expect((await campaignRow(paused.id)).status).toBe('PAUSED');

      const resumed = await as(marketingToken).post(`/platform/marketing/campaigns/${paused.id}/resume`);
      expect(resumed.status).toBe(200);
      expect(resumed.body).toMatchObject({ status: 'SCHEDULED', pauseReason: null });
      // A day later the bad e-mails are out of the 24 hour window: no verdict, no pause.
      const recovered = await guards.runFuse(new Date(now.getTime() + 26 * HOUR));
      expect(recovered.tripped).toEqual([]);
      expect((await campaignRow(paused.id)).status).toBe('SCHEDULED');
    });

    it('alerts again after 24 hours, per reason, and the complaint threshold works on its own', async () => {
      const later = new Date('2030-03-13T12:00:00.000Z');
      await emailLogs(new Date(later.getTime() - HOUR), 499, 0, 1);
      const id = await emailCampaign('complaint email', 'SENDING');
      const result = await guards.runFuse(later);
      expect(result).toMatchObject({ tripped: ['COMPLAINT'], alertsSent: 1 });
      expect((await campaignRow(id)).pauseReason).toBe('AUTO_COMPLAINT');
      expect(await notices('MARKETING_EMAIL_FUSE_TRIPPED')).toBe(2);
      // Both reasons on the same day: the bounce alert of two days ago is old enough, the complaint one is not.
      await emailLogs(new Date(later.getTime() - HOUR), 0, 20);
      const both = await guards.runFuse(new Date(later.getTime() + 5 * 60_000));
      expect(both.tripped).toEqual(['BOUNCE', 'COMPLAINT']);
      expect(both.alertsSent).toBe(1);
      expect(await notices('MARKETING_EMAIL_FUSE_TRIPPED')).toBe(3);
    });

    it('uses the thresholds of the marketing settings', async () => {
      const now = new Date('2030-04-01T12:00:00.000Z');
      await emailLogs(new Date(now.getTime() - HOUR), 90, 10);
      expect((await settings({ bounceAutoPausePct: 20 })).status).toBe(200);
      expect((await guards.runFuse(now)).tripped).toEqual([]);
      expect((await settings({ bounceAutoPausePct: 5 })).status).toBe(200);
      expect((await guards.runFuse(now)).tripped).toEqual(['BOUNCE']);
      expect((await settings({ bounceAutoPausePct: 2 })).status).toBe(200);
    });
  });

  describe('daily send caps with deferral', () => {
    let campaignId: string;
    const CAP_DAY = new Date('2030-05-06T12:00:00.000Z');

    beforeAll(async () => {
      for (let i = 0; i < 8; i += 1) {
        const contact = await prisma.contact.create({
          data: { studioId: PLATFORM, firstName: `M3d${i}`, lastName: 'M3dMarker', phone: `${PREFIX}${String(i).padStart(4, '0')}`, countryCode: 'TR', timezone: daytimeZone(), locale: 'tr', lifecycleStage: 'LEAD' },
        });
        await prisma.contactConsent.create({ data: { studioId: PLATFORM, contactId: contact.id, channel: 'SMS', status: 'GRANTED', source: 'e2e', grantedAt: new Date() } });
        contactIds.push(contact.id);
      }
      const campaign = await prisma.campaign.create({
        data: { studioId: PLATFORM, name: 'M3d e2e cap sms', segmentId, channel: 'SMS', templateKey, status: 'SENDING', startedAt: new Date('2030-05-06T08:00:00.000Z'), audienceCount: contactIds.length },
      });
      campaignId = campaign.id;
      campaignIds.push(campaign.id);
      await prisma.campaignRecipient.createMany({ data: contactIds.map((contactId) => ({ studioId: PLATFORM, campaignId, contactId })) });
    });

    const counts = async () => ({
      sent: await prisma.campaignRecipient.count({ where: { campaignId, status: 'SENT' } }),
      deferred: await prisma.campaignRecipient.count({ where: { campaignId, status: 'PENDING', reasonCode: 'DAILY_SMS_CAP' } }),
    });

    it('sends up to the cap and defers the rest to the next UTC day, recorded on the campaign', async () => {
      expect((await settings({ dailySmsCreditCap: 3 })).status).toBe(200);
      const totals = await campaigns.processCampaign(campaignId, CAP_DAY, 5);
      expect(totals.sent).toBe(3);
      expect(await counts()).toEqual({ sent: 3, deferred: 5 });
      const pending = await prisma.campaignRecipient.findMany({ where: { campaignId, status: 'PENDING' } });
      expect(pending.every((r) => r.nextAttemptAt?.toISOString() === '2030-05-07T00:00:00.000Z')).toBe(true);
      expect((await campaignRow(campaignId)).status).toBe('SENDING');

      const detail = await request(server).get(`/studios/${PLATFORM}/campaigns/${campaignId}`).set('Authorization', `Bearer ${superAdminToken}`).set('x-studio-id', PLATFORM);
      expect(detail.body.stats).toMatchObject({ sent: 3, pending: 5, deferredByCap: 5, deferredUntil: '2030-05-07T00:00:00.000Z' });
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.campaign.cap_deferred', entityId: campaignId } })).toBe(1);
      const recipients = await request(server)
        .get(`/studios/${PLATFORM}/campaigns/${campaignId}/recipients?status=PENDING&limit=50`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-studio-id', PLATFORM);
      expect(recipients.body.items.every((r: { reasonCode: string | null }) => r.reasonCode === 'DAILY_SMS_CAP')).toBe(true);
      expect((await dashboard()).caps.deferredRecipients).toBeGreaterThanOrEqual(5);
    });

    it('nothing more goes out the same day, a new day sends up to the cap again, and the campaign finishes', async () => {
      expect((await campaigns.processCampaign(campaignId, new Date('2030-05-06T18:00:00.000Z'), 5)).sent).toBe(0);
      expect(await counts()).toEqual({ sent: 3, deferred: 5 });

      expect((await campaigns.processCampaign(campaignId, new Date('2030-05-07T12:00:00.000Z'), 5)).sent).toBe(3);
      expect(await counts()).toEqual({ sent: 6, deferred: 2 });
      expect((await campaignRow(campaignId)).status).toBe('SENDING');

      expect((await campaigns.processCampaign(campaignId, new Date('2030-05-08T12:00:00.000Z'), 5)).sent).toBe(2);
      expect(await counts()).toEqual({ sent: 8, deferred: 0 });
      expect((await campaignRow(campaignId)).status).toBe('SENT');
      // One audit entry per deferring day, not per run.
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.campaign.cap_deferred', entityId: campaignId } })).toBe(2);
    });

    it('no cap means no deferral', async () => {
      expect((await settings({ dailySmsCreditCap: null })).status).toBe(200);
      const contact = contactIds[0]!;
      const open = await prisma.campaign.create({
        data: { studioId: PLATFORM, name: 'M3d e2e uncapped sms', segmentId, channel: 'SMS', templateKey, status: 'SENDING', startedAt: new Date('2030-06-03T08:00:00.000Z'), audienceCount: 8 },
      });
      campaignIds.push(open.id);
      await prisma.campaignRecipient.createMany({ data: contactIds.map((contactId) => ({ studioId: PLATFORM, campaignId: open.id, contactId })) });
      expect(contact).toBeDefined();
      const totals = await campaigns.processCampaign(open.id, new Date('2030-06-03T12:00:00.000Z'), 5);
      expect(totals.sent + totals.skipped + totals.failed).toBe(8);
      expect(await prisma.campaignRecipient.count({ where: { campaignId: open.id, reasonCode: 'DAILY_SMS_CAP' } })).toBe(0);
    });

    it('shows the e-mail cap with the warm-up plan on the dashboard: the lower of the plan and the configured cap', async () => {
      const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
      await prisma.emailSenderDomain.create({ data: { studioId: PLATFORM, domain: `m3d-e2e-${runId}.example.com`, purpose: 'MARKETING', spfStatus: 'VALID', dkimStatus: 'VALID', dmarcStatus: 'VALID', warmupStartedAt: today } });
      expect((await settings({ dailyEmailCap: 500, emailWarmupPlan: [7, 9] })).status).toBe(200);
      expect((await dashboard()).caps.email).toMatchObject({ cap: 7, source: 'WARMUP', warmupDay: 1 });
      expect((await settings({ dailyEmailCap: 5 })).status).toBe(200);
      expect((await dashboard()).caps.email).toMatchObject({ cap: 5, source: 'CONFIGURED' });
      // Without a plan there is no warm-up.
      expect((await settings({ dailyEmailCap: 500, emailWarmupPlan: null })).status).toBe(200);
      expect((await dashboard()).caps.email).toMatchObject({ cap: 500, source: 'CONFIGURED', warmupDay: null });
      expect((await settings({ emailWarmupPlan: [] })).status).toBe(400);
      expect((await settings({ dailyEmailCap: null })).status).toBe(200);
      expect((await dashboard()).caps.email).toMatchObject({ cap: null, source: 'NONE' });
    });
  });

  describe('ad spend cap per currency', () => {
    it('flags the dashboard in red per currency and alerts the super admin once per month per currency, without pausing anything', async () => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      await prisma.adSpendDaily.createMany({
        data: [
          { studioId: PLATFORM, platform: 'META', level: 'CAMPAIGN', externalId: 'm3d-e2e-cap-1', date: monthStart, spendAmount: new Prisma.Decimal('150.00'), currency: 'USD' },
          { studioId: PLATFORM, platform: 'META', level: 'CAMPAIGN', externalId: 'm3d-e2e-cap-2', date: monthStart, spendAmount: new Prisma.Decimal('50.00'), currency: 'EUR' },
          // An ad set row repeats its campaign's spend and must not count twice.
          { studioId: PLATFORM, platform: 'META', level: 'ADSET', externalId: 'm3d-e2e-cap-3', date: monthStart, spendAmount: new Prisma.Decimal('999.00'), currency: 'USD' },
        ],
      });
      expect((await settings({ monthlyAdSpendCaps: { USD: '100.00', EUR: '500.00', GBP: '10' } })).status).toBe(200);

      const health = await dashboard();
      const status = Object.fromEntries(health.adSpendCaps.map((s) => [s.currency, s]));
      expect(status.USD).toMatchObject({ cap: '100.00', spent: '150.00', exceeded: true });
      expect(status.EUR).toMatchObject({ spent: '50.00', exceeded: false });
      expect(status.GBP).toMatchObject({ spent: '0.00', exceeded: false });

      expect(await guards.runAdSpendCaps(now)).toBe(1);
      expect(await guards.runAdSpendCaps(now)).toBe(0);
      expect(await guards.runAdSpendCaps(new Date(now.getTime() + 60_000))).toBe(0);
      expect(await notices('MARKETING_AD_CAP_EXCEEDED')).toBe(1);
      const alert = await prisma.notificationLog.findFirstOrThrow({ where: { studioId: PLATFORM, userId: superAdminId, channel: 'IN_APP', type: 'MARKETING_AD_CAP_EXCEEDED' } });
      expect(alert.content).toContain('USD');
      expect(alert.content).not.toContain('EUR');

      // A second currency going over gets its own alert.
      await prisma.adSpendDaily.create({ data: { studioId: PLATFORM, platform: 'GOOGLE', level: 'CAMPAIGN', externalId: 'm3d-e2e-cap-4', date: monthStart, spendAmount: new Prisma.Decimal('500.01'), currency: 'EUR' } });
      expect(await guards.runAdSpendCaps(now)).toBe(1);
      expect(await notices('MARKETING_AD_CAP_EXCEEDED')).toBe(2);
      // No automatic ad pause: the connections are untouched (M5 adds the option).
      expect(await prisma.adConnection.count({ where: { studioId: PLATFORM, status: 'PAUSED' } })).toBe(0);
      expect((await settings({ monthlyAdSpendCaps: {} })).status).toBe(200);
      expect((await dashboard()).adSpendCaps).toEqual([]);
    });
  });

  describe('pending approvals on the dashboard', () => {
    it('counts the requests that are waiting: pending and not expired', async () => {
      const before = (await dashboard()).approvals;
      expect(before.available).toBe(true);
      const base = { studioId: PLATFORM, targetType: 'CAMPAIGN' as const, targetId: campaignIds[0]!, contentHash: 'a'.repeat(64), summary: { m3dE2e: true }, requestedByUserId: marketingUserId };
      await prisma.approvalRequest.createMany({
        data: [
          { ...base, status: 'PENDING', expiresAt: new Date(Date.now() + DAY) },
          { ...base, status: 'PENDING', expiresAt: new Date(Date.now() + 2 * DAY) },
          // Past its TTL (the heartbeat has not marked it yet) and already decided: neither is waiting.
          { ...base, status: 'PENDING', expiresAt: new Date(Date.now() - HOUR) },
          { ...base, status: 'APPROVED', expiresAt: new Date(Date.now() + DAY), decidedByUserId: superAdminId, decidedAt: new Date() },
        ],
      });
      expect((await dashboard()).approvals).toEqual({ available: true, pending: before.pending + 2 });
      for (const token of [marketingToken, viewerToken]) expect((await as(token).get('/platform/marketing/dashboard')).status).toBe(200);
      expect((await as(ownerToken).get('/platform/marketing/dashboard')).status).toBe(403);
    });
  });

  describe('audit view', () => {
    const otherUserAction = 'm3d.e2e.audit.other';
    let firstId: string;

    beforeAll(async () => {
      const t = (offsetMin: number) => new Date(Date.UTC(2030, 0, 1, 10, offsetMin));
      const rows = [
        { userId: superAdminId, action: 'm3d.e2e.audit.first', entityType: 'M3dE2e', entityId: 'e1', metadata: { note: 'mail ada@example.com, tel +90 532 123 45 67', count: 3, nested: { a: 1 } }, createdAt: t(0) },
        { userId: superAdminId, action: 'm3d.e2e.audit.second', entityType: 'M3dE2e', entityId: 'e2', metadata: { ok: true }, createdAt: t(10) },
        { userId: marketingUserId, action: otherUserAction, entityType: 'M3dE2e', entityId: 'e3', metadata: Prisma.JsonNull, createdAt: t(20) },
        { userId: null, action: 'm3d.e2e.audit.system', entityType: 'M3dE2e', entityId: null, metadata: Prisma.JsonNull, createdAt: t(30) },
        { userId: superAdminId, action: 'm3d.e2ex.sibling', entityType: 'M3dE2e', entityId: 'e5', metadata: Prisma.JsonNull, createdAt: t(40) },
      ];
      for (const row of rows) {
        const created = await prisma.auditLog.create({ data: { studioId: null, ...row, metadata: row.metadata === null ? Prisma.JsonNull : (row.metadata as Prisma.InputJsonValue) } });
        if (row.entityId === 'e1') firstId = created.id;
      }
    });

    it('is for the super admin only', async () => {
      for (const token of [marketingToken, viewerToken, ownerToken]) expect((await as(token).get('/admin/audit')).status).toBe(403);
      expect((await request(server).get('/admin/audit')).status).toBe(401);
    });

    it('lists newest first with the acting user, target and a redacted metadata summary', async () => {
      const res = await as(superAdminToken).get('/admin/audit?action=m3d.e2e&limit=10');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 4, page: 1, limit: 10 });
      // "m3d.e2e" matches the actions under it (the prefix followed by a dot), not "m3d.e2ex.sibling".
      expect(res.body.items.map((i: { action: string }) => i.action)).toEqual(['m3d.e2e.audit.system', 'm3d.e2e.audit.other', 'm3d.e2e.audit.second', 'm3d.e2e.audit.first']);
      const first = res.body.items.find((i: { id: string }) => i.id === firstId);
      expect(first).toMatchObject({ userId: superAdminId, entityType: 'M3dE2e', entityId: 'e1' });
      expect(first.userName).toEqual(expect.any(String));
      expect(first.metadataSummary).toContain('count: 3');
      expect(first.metadataSummary).toContain('nested: {...}');
      expect(first.metadataSummary).not.toContain('ada@example.com');
      expect(first.metadataSummary).not.toContain('532 123');
      expect(res.body.items.find((i: { action: string }) => i.action === 'm3d.e2e.audit.system')).toMatchObject({ userId: null, userName: null, metadataSummary: '' });
    });

    it('filters by user, by action (exact or prefix) and by period', async () => {
      const byUser = await as(superAdminToken).get(`/admin/audit?userId=${marketingUserId}&action=m3d.e2e`);
      expect(byUser.body.items.map((i: { action: string }) => i.action)).toEqual([otherUserAction]);

      const exact = await as(superAdminToken).get('/admin/audit?action=m3d.e2e.audit.first');
      expect(exact.body.total).toBe(1);
      const sibling = await as(superAdminToken).get('/admin/audit?action=m3d.e2e.audit');
      expect(sibling.body.total).toBe(4);
      const none = await as(superAdminToken).get('/admin/audit?action=m3d.e2e.nothing');
      expect(none.body).toMatchObject({ total: 0, items: [] });

      const window = await as(superAdminToken).get('/admin/audit?action=m3d.e2e&from=2030-01-01T10:05:00.000Z&to=2030-01-01T10:25:00.000Z');
      expect(window.body.items.map((i: { action: string }) => i.action)).toEqual([otherUserAction, 'm3d.e2e.audit.second']);
    });

    it('pages the result and validates the query', async () => {
      const page1 = await as(superAdminToken).get('/admin/audit?action=m3d.e2e.audit&limit=3&page=1');
      const page2 = await as(superAdminToken).get('/admin/audit?action=m3d.e2e.audit&limit=3&page=2');
      expect(page1.body.items).toHaveLength(3);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body).toMatchObject({ total: 4, page: 2, limit: 3 });
      const ids = [...page1.body.items, ...page2.body.items].map((i: { id: string }) => i.id);
      expect(new Set(ids).size).toBe(4);
      expect((await as(superAdminToken).get('/admin/audit?userId=nope')).status).toBe(400);
      expect((await as(superAdminToken).get('/admin/audit?page=0')).status).toBe(400);
      expect((await as(superAdminToken).get('/admin/audit?limit=1000')).status).toBe(400);
      expect((await as(superAdminToken).get('/admin/audit?from=2030-02-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z')).status).toBe(400);
    });

    it('records the marketing guards of this suite (the fuse and the settings) so they can be found by action', async () => {
      const fuse = await as(superAdminToken).get('/admin/audit?action=marketing.campaign.auto_paused&limit=50');
      expect(fuse.status).toBe(200);
      expect(fuse.body.total).toBeGreaterThanOrEqual(3);
      expect(fuse.body.items.every((i: { action: string }) => i.action === 'marketing.campaign.auto_paused')).toBe(true);
      const settingsChanges = await as(superAdminToken).get(`/admin/audit?action=marketing.settings&userId=${superAdminId}&limit=5`);
      expect(settingsChanges.body.items.length).toBeGreaterThan(0);
    });
  });

  describe('heartbeat wiring', () => {
    it('the scheduler run reports the guards and the weekly summary step', async () => {
      expect((await settings({ weeklySummaryEnabled: false })).status).toBe(200);
      const res = await as(superAdminToken).post('/admin/scheduler/run').send({});
      expect(res.status).toBe(201);
      expect(res.body.marketingInsights).toEqual({ generated: false, skipped: 'DISABLED' });
      expect(res.body.growth.marketingGuards.fuse.checked).toBe(true);
      expect(res.body.growth.marketingGuards).toHaveProperty('adSpendAlerts');
    });
  });
});
