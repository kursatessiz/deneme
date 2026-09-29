import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@platform/database';
import { normalizePhone } from '@platform/shared';
import type { MarketingDashboardDTO } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * M3a platform marketing dashboard (docs/PAZARLAMA_MODULU.md 3.3): a
 * constructed scenario on the platform tenant in fixed past periods (March
 * 2025, previous period 29 January to 28 February 2025) so the numbers never
 * depend on the clock: visitors, leads, MQL and SQL stage moves, signups,
 * paid studios in two currencies, ad spend in two currencies (plus an ad-set
 * row that must not be counted), trials, notification logs with bounces and
 * complaints, a connection error and a failed delivery. It checks the
 * funnel, CAC/CPL/ROI per currency, trial to paid, channel rows, channel
 * health, the MRR block permission, compare=previous, that the response has
 * no person data, and that only platform users get in. Everything it creates
 * is removed in afterAll so the suite can run twice on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const ZEN_OWNER_PHONE = '+905321000002';
const MARKER = 'M3aMarker';
const PHONE_PREFIX = '+90538555';
const SLUG_PREFIX = 'e2e-m3a-';
const FROM = '2025-03-01T00:00:00.000Z';
const TO = '2025-03-31T23:59:59.999Z';
const QUERY = `from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;

const at = (day: string, time = '10:00:00') => new Date(`${day}T${time}.000Z`);
const DAY_SECONDS = 86_400;

describe('Marketing dashboard (M3a) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const startedAt = new Date();
  const runId = Date.now().toString().slice(-7);

  let PLATFORM: string;
  let ZEN: string;
  let superAdminToken: string;
  let ownerToken: string;
  let viewerToken: string;
  let readerToken: string;
  let previousMfaPolicy: boolean | undefined;
  let previousAiSettings: { marketingAiMonthlyBudgetCents: number } | null = null;
  let baselineConnectionErrors = 0;
  let starterTryPrice = '';
  let proUsdPrice = '';

  const viewerPhone = normalizePhone(`0535${runId}`)!;
  const readerPhone = normalizePhone(`0534${runId}`)!;
  const viewerRoleKey = `m3a_viewer_${runId}`;
  const readerRoleKey = `m3a_reader_${runId}`;

  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const dashboard = (token: string, query = QUERY) => request(server).get(`/platform/marketing/dashboard?${query}`).set('Authorization', `Bearer ${token}`);
  const asStudio = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const body = async (token: string, query = QUERY): Promise<MarketingDashboardDTO> => {
    const res = await dashboard(token, query);
    expect(res.status).toBe(200);
    return res.body as MarketingDashboardDTO;
  };
  const money = (list: Array<{ currency: string; amount: string }>) => Object.fromEntries(list.map((m) => [m.currency, m.amount]));
  const ratio = (list: Array<{ currency: string; value: number | null }>) => Object.fromEntries(list.map((m) => [m.currency, m.value]));

  async function cleanup(): Promise<void> {
    await prisma.conversionDelivery.deleteMany({ where: { studioId: PLATFORM, conversionEvent: { sourceKind: 'm3a-e2e' } } });
    await prisma.touchpoint.deleteMany({ where: { studioId: PLATFORM, landingPath: '/m3a-e2e' } });
    await prisma.visitor.deleteMany({ where: { studioId: PLATFORM, firstSeenAt: { lt: new Date('2025-06-01') } } });
    await prisma.contact.deleteMany({ where: { studioId: PLATFORM, lastName: MARKER } });
    await prisma.adSpendDaily.deleteMany({ where: { studioId: PLATFORM, externalId: { startsWith: 'm3a-' } } });
    await prisma.adEntity.deleteMany({ where: { studioId: PLATFORM, externalId: { startsWith: 'm3a-' } } });
    await prisma.adConnection.deleteMany({ where: { studioId: PLATFORM, label: { startsWith: 'M3a e2e' } } });
    await prisma.notificationLog.deleteMany({ where: { studioId: PLATFORM, content: 'M3a e2e' } });
    await prisma.aiUsage.deleteMany({ where: { studioId: PLATFORM, createdAt: { gte: startedAt } } });
    await prisma.studio.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
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
    baselineConnectionErrors = await prisma.adConnection.count({ where: { studioId: PLATFORM, lastError: { not: null } } });

    // Platform users: view only, and view plus the referral report.
    const previous = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
    previousMfaPolicy = previous?.require2faForPlatformRoles;
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', require2faForPlatformRoles: false }, update: { require2faForPlatformRoles: false } });
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const viewerRole = await prisma.platformRoleTemplate.create({
      data: { key: viewerRoleKey, name: 'M3a salt okunur', permissions: { create: [{ permissionKey: 'platform.marketing.view' }] } },
    });
    const readerRole = await prisma.platformRoleTemplate.create({
      data: { key: readerRoleKey, name: 'M3a gelir', permissions: { create: [{ permissionKey: 'platform.marketing.view' }, { permissionKey: 'platform.referrals.view' }] } },
    });
    const viewer = await prisma.user.create({ data: { phone: viewerPhone, firstName: 'Salt', lastName: 'Okunur', passwordHash, phoneVerifiedAt: new Date() } });
    const reader = await prisma.user.create({ data: { phone: readerPhone, firstName: 'Gelir', lastName: 'Gorur', passwordHash, phoneVerifiedAt: new Date() } });
    await prisma.platformMembership.create({ data: { userId: viewer.id, roleTemplateId: viewerRole.id, status: 'ACTIVE', activatedAt: new Date() } });
    await prisma.platformMembership.create({ data: { userId: reader.id, roleTemplateId: readerRole.id, status: 'ACTIVE', activatedAt: new Date() } });

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    ownerToken = await login(ZEN_OWNER_PHONE);
    viewerToken = await login(viewerPhone);
    readerToken = await login(readerPhone);

    // The marketing AI budget: 10 USD, 8.5 USD used this month (a warning).
    previousAiSettings = await prisma.aiSettings.findUnique({ where: { id: 'platform' }, select: { marketingAiMonthlyBudgetCents: true } });
    await prisma.aiSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', marketingAiMonthlyBudgetCents: 1000 }, update: { marketingAiMonthlyBudgetCents: 1000 } });
    await prisma.aiUsage.create({ data: { studioId: PLATFORM, task: 'MARKETING_DRAFT', model: 'm3a-e2e', costMicroUsd: 8_500_000, success: true } });

    // ---- CRM scenario -------------------------------------------------
    let n = 0;
    const contact = async (label: string, over: { isTest?: boolean } = {}) =>
      prisma.contact.create({ data: { studioId: PLATFORM, firstName: `${label}`, lastName: MARKER, phone: `${PHONE_PREFIX}${String(1000 + ++n)}`, isTest: over.isTest ?? false } });
    const touch = async (contactId: string, day: string, source: string, campaignId: string, time = '09:00:00') => {
      const visitorId = randomUUID();
      await prisma.visitor.create({ data: { id: visitorId, studioId: PLATFORM, contactId, firstSeenAt: at(day, time), lastSeenAt: at(day, time) } });
      await prisma.touchpoint.create({
        data: { studioId: PLATFORM, visitorId, sessionId: randomUUID(), occurredAt: at(day, time), landingPath: '/m3a-e2e', utmSource: source, pwCid: campaignId, contactId },
      });
    };
    const event = (contactId: string, type: string, day: string, value?: { amount: string; currency: string }, isTest = false) =>
      prisma.conversionEvent.create({
        data: {
          studioId: PLATFORM,
          contactId,
          type,
          occurredAt: at(day),
          eventId: `m3a-${runId}-${++n}`,
          sourceKind: 'm3a-e2e',
          sourceId: `m3a-${runId}-${n}`,
          isTest,
          ...(value ? { valueAmount: value.amount, currency: value.currency } : {}),
        },
      });
    const stage = (contactId: string, to: string, day: string) =>
      prisma.contactActivity.create({
        data: { studioId: PLATFORM, contactId, type: 'STAGE_CHANGE', body: `stage ${to}`, metadata: { from: 'NEW', to }, createdAt: at(day) },
      });

    // A1: the whole way, paid in USD (Meta campaign).
    const a1 = await contact('A1');
    await touch(a1.id, '2025-03-02', 'meta', 'm3a-cmp-meta-1');
    const a1Lead = await event(a1.id, 'lead', '2025-03-02');
    await stage(a1.id, 'MQL', '2025-03-03');
    await stage(a1.id, 'SQL', '2025-03-05');
    await event(a1.id, 'studio_signup', '2025-03-08');
    await event(a1.id, 'studio_paid', '2025-03-12', { amount: '119.00', currency: 'USD' });
    // A2: the whole way, paid in TRY (Google campaign), a day slower at the end.
    const a2 = await contact('A2');
    await touch(a2.id, '2025-03-03', 'google', 'm3a-cmp-g-1');
    await event(a2.id, 'lead', '2025-03-03');
    await stage(a2.id, 'MQL', '2025-03-04');
    await stage(a2.id, 'SQL', '2025-03-06');
    await event(a2.id, 'studio_signup', '2025-03-09');
    await event(a2.id, 'studio_paid', '2025-03-15', { amount: '3490.00', currency: 'TRY' });
    // A3: signed up, never paid.
    const a3 = await contact('A3');
    await touch(a3.id, '2025-03-04', 'meta', 'm3a-cmp-meta-1');
    await event(a3.id, 'lead', '2025-03-04');
    await stage(a3.id, 'MQL', '2025-03-05');
    await stage(a3.id, 'SQL', '2025-03-07');
    await event(a3.id, 'studio_signup', '2025-03-10');
    // A4: MQL only. A5, A6: leads only.
    const a4 = await contact('A4');
    await touch(a4.id, '2025-03-05', 'google', 'm3a-cmp-g-1');
    await event(a4.id, 'lead', '2025-03-05');
    await stage(a4.id, 'MQL', '2025-03-06');
    for (const [label, day, source, cid] of [['A5', '2025-03-06', 'meta', 'm3a-cmp-meta-1'], ['A6', '2025-03-07', 'google', 'm3a-cmp-g-1']] as const) {
      const c = await contact(label);
      await touch(c.id, day, source, cid);
      await event(c.id, 'lead', day);
    }
    // A test contact with the whole journey: counted nowhere.
    const test = await contact('T1', { isTest: true });
    await touch(test.id, '2025-03-02', 'meta', 'm3a-cmp-meta-1');
    await event(test.id, 'lead', '2025-03-02');
    await event(test.id, 'studio_paid', '2025-03-12', { amount: '999.00', currency: 'USD' });

    // Previous period: P1 lead and paid straight away (skipping MQL/SQL), P2 a lead only.
    const p1 = await contact('P1');
    await touch(p1.id, '2025-02-10', 'meta', 'm3a-cmp-meta-1');
    await event(p1.id, 'lead', '2025-02-10');
    await event(p1.id, 'studio_paid', '2025-02-20', { amount: '200.00', currency: 'USD' });
    const p2 = await contact('P2');
    await touch(p2.id, '2025-02-12', 'meta', 'm3a-cmp-meta-1');
    await event(p2.id, 'lead', '2025-02-12');

    // ---- Ad spend and ad names ---------------------------------------
    const spend = (platform: string, level: string, externalId: string, day: string, amount: string, currency: string) =>
      prisma.adSpendDaily.create({ data: { studioId: PLATFORM, platform, level, externalId, date: new Date(day), spendAmount: amount, currency } });
    await spend('META', 'CAMPAIGN', 'm3a-cmp-meta-1', '2025-03-05', '100.00', 'USD');
    await spend('META', 'CAMPAIGN', 'm3a-cmp-meta-1', '2025-03-06', '50.00', 'USD');
    await spend('META', 'CAMPAIGN', 'm3a-cmp-meta-2', '2025-03-08', '10.00', 'USD');
    await spend('META', 'ADSET', 'm3a-adset-1', '2025-03-05', '999.00', 'USD');
    await spend('GOOGLE', 'CAMPAIGN', 'm3a-cmp-g-1', '2025-03-10', '6000.00', 'TRY');
    await spend('META', 'CAMPAIGN', 'm3a-cmp-meta-1', '2025-02-10', '50.00', 'USD');
    await prisma.adEntity.create({ data: { studioId: PLATFORM, platform: 'META', level: 'CAMPAIGN', externalId: 'm3a-cmp-meta-1', name: 'M3a Meta launch', status: 'ACTIVE' } });

    // ---- Connection error and delivery outbox ------------------------
    await prisma.adConnection.create({
      data: {
        studioId: PLATFORM,
        platform: 'META',
        label: 'M3a e2e broken',
        status: 'ERROR',
        externalAccountId: 'act_m3a',
        encryptedCredentials: 'not-a-credential',
        credentialLast4: '0000',
        lastError: 'Token expired for ops@example.com access_token=EAAB1234567890abcdefXYZ',
      },
    });
    await prisma.adConnection.create({
      data: { studioId: PLATFORM, platform: 'GOOGLE', label: 'M3a e2e healthy', status: 'CONNECTED', externalAccountId: '123-456', encryptedCredentials: 'not-a-credential', credentialLast4: '0000' },
    });
    await prisma.conversionDelivery.create({ data: { studioId: PLATFORM, conversionEventId: a1Lead.id, target: 'META_CAPI', status: 'FAILED', createdAt: at('2025-03-12') } });
    await prisma.conversionDelivery.create({ data: { studioId: PLATFORM, conversionEventId: a1Lead.id, target: 'GOOGLE_ADS', status: 'SENT', createdAt: at('2025-03-12') } });

    // ---- Notification logs -------------------------------------------
    const logs = (channel: 'EMAIL' | 'SMS', status: 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'SENT' | 'FAILED' | 'PENDING', count: number, day: string) =>
      prisma.notificationLog.createMany({
        data: Array.from({ length: count }, () => ({
          studioId: PLATFORM,
          channel,
          type: 'M3A_E2E',
          content: 'M3a e2e',
          status,
          createdAt: at(day),
          ...(status === 'BOUNCED' ? { bouncedAt: at(day) } : {}),
          ...(status === 'COMPLAINED' ? { complainedAt: at(day) } : {}),
          ...(status === 'DELIVERED' ? { deliveredAt: at(day) } : {}),
        })),
      });
    // Last 7 days of March: 50 accepted e-mails (3 bounced, 1 complaint) and rows that do not count.
    await logs('EMAIL', 'DELIVERED', 45, '2025-03-28');
    await logs('EMAIL', 'BOUNCED', 3, '2025-03-28');
    await logs('EMAIL', 'COMPLAINED', 1, '2025-03-28');
    await logs('EMAIL', 'SENT', 1, '2025-03-28');
    await logs('EMAIL', 'FAILED', 2, '2025-03-28');
    await logs('EMAIL', 'PENDING', 1, '2025-03-28');
    // Earlier in March: 150 more delivered e-mails, so the 30 day bounce rate is 1.5 percent.
    await logs('EMAIL', 'DELIVERED', 150, '2025-03-10');
    await logs('SMS', 'DELIVERED', 8, '2025-03-28');
    await logs('SMS', 'FAILED', 1, '2025-03-28');
    await logs('SMS', 'PENDING', 1, '2025-03-28');
    await logs('SMS', 'DELIVERED', 6, '2025-03-10');

    // ---- Studios: trials, paying studios and their plans -------------
    const starter = await prisma.plan.findUniqueOrThrow({ where: { key: 'starter' }, include: { prices: true } });
    const pro = await prisma.plan.findUniqueOrThrow({ where: { key: 'pro' }, include: { prices: true } });
    starterTryPrice = Number(starter.prices.find((p) => p.currency === 'TRY')!.priceMonthly).toFixed(2);
    proUsdPrice = Number(pro.prices.find((p) => p.currency === 'USD')!.priceMonthly).toFixed(2);
    const studio = async (label: string, trial: string, activated: string | null, planId: string, billingCurrency: 'TRY' | 'USD') => {
      const s = await prisma.studio.create({
        data: {
          name: `M3a ${label}`,
          slug: `${SLUG_PREFIX}${runId}-${label}`,
          billingStatus: activated ? 'ACTIVE' : 'TRIALING',
          trialStartedAt: at(trial, '08:00:00'),
          activatedAt: activated ? at(activated, '08:00:00') : null,
          billingCurrency,
        },
      });
      await prisma.subscription.create({
        data: { studioId: s.id, planId, status: activated ? 'ACTIVE' : 'TRIALING', currentPeriodStart: at(trial), currentPeriodEnd: at('2025-12-31') },
      });
    };
    await studio('s1', '2025-03-01', '2025-03-11', starter.id, 'TRY'); // 10 days
    await studio('s2', '2025-03-02', '2025-03-22', pro.id, 'USD'); // 20 days
    await studio('s3', '2025-03-03', null, starter.id, 'TRY'); // still trialing
    await studio('s4', '2025-02-10', '2025-02-20', starter.id, 'TRY'); // previous period, paid after 10 days
  });

  afterAll(async () => {
    await cleanup();
    if (previousAiSettings) {
      await prisma.aiSettings.update({ where: { id: 'platform' }, data: { marketingAiMonthlyBudgetCents: previousAiSettings.marketingAiMonthlyBudgetCents } });
    } else {
      await prisma.aiSettings.deleteMany({ where: { id: 'platform' } });
    }
    const users = await prisma.user.findMany({ where: { phone: { in: [viewerPhone, readerPhone] } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await prisma.platformRoleTemplate.deleteMany({ where: { key: { in: [viewerRoleKey, readerRoleKey] } } });
    if (previousMfaPolicy !== undefined) {
      await prisma.platformAccessSettings.update({ where: { id: 'platform' }, data: { require2faForPlatformRoles: previousMfaPolicy } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('access', () => {
    it('rejects anonymous callers and tenant users without platform access', async () => {
      expect((await request(server).get(`/platform/marketing/dashboard?${QUERY}`)).status).toBe(401);
      expect((await dashboard(ownerToken)).status).toBe(403);
    });

    it('validates the query', async () => {
      expect((await dashboard(superAdminToken, `from=${encodeURIComponent(FROM)}`)).status).toBe(400);
      expect((await dashboard(superAdminToken, `from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`)).status).toBe(400);
      expect((await dashboard(superAdminToken, `${QUERY}&compare=year`)).status).toBe(400);
    });

    it('answers a platform viewer and defaults to a recent period without a range', async () => {
      const res = await dashboard(viewerToken, 'compare=previous');
      expect(res.status).toBe(200);
      const dto = res.body as MarketingDashboardDTO;
      expect(new Date(dto.current.to).getTime() - new Date(dto.current.from).getTime()).toBe(30 * 86_400_000);
      expect(dto.previous).not.toBeNull();
    });
  });

  describe('the dashboard for March 2025', () => {
    let dto: MarketingDashboardDTO;
    beforeAll(async () => {
      dto = await body(superAdminToken);
    });

    it('returns the platform_b2b funnel with counts, step rates and median times', () => {
      expect(dto.current.funnel.id).toBe('ready.platform_b2b');
      expect(dto.current.funnel.steps.map((s) => s.key)).toEqual(['visit', 'lead', 'stage:MQL', 'stage:SQL', 'studio_signup', 'studio_paid']);
      // The test contact is not counted anywhere.
      expect(dto.current.funnel.steps.map((s) => s.reached)).toEqual([6, 6, 4, 3, 3, 2]);
      const [visit, lead, mql, sql, signup, paid] = dto.current.funnel.steps;
      expect(lead.rateFromPrevious).toBe(1);
      expect(mql.rateFromPrevious).toBeCloseTo(4 / 6, 10);
      expect(sql.rateFromPrevious).toBeCloseTo(3 / 4, 10);
      expect(signup.rateFromPrevious).toBe(1);
      expect(paid.rateFromPrevious).toBeCloseTo(2 / 3, 10);
      expect(paid.rateFromFirst).toBeCloseTo(2 / 6, 10);
      expect(visit.medianSecondsFromPrevious).toBeNull();
      expect(lead.medianSecondsFromPrevious).toBe(3600);
      expect(mql.medianSecondsFromPrevious).toBe(DAY_SECONDS);
      expect(sql.medianSecondsFromPrevious).toBe(2 * DAY_SECONDS);
      expect(signup.medianSecondsFromPrevious).toBe(3 * DAY_SECONDS);
      // A1 paid 4 days after signup, A2 6 days: the median is 5 days.
      expect(paid.medianSecondsFromPrevious).toBe(5 * DAY_SECONDS);
    });

    it('computes CAC, CPL, revenue and ROI per currency without mixing them', () => {
      const a = dto.current.acquisition;
      expect(a.leads).toBe(6);
      expect(a.studioPaid).toBe(2);
      // The ad-set row (999 USD) is not counted: campaign level only.
      expect(money(a.spend)).toEqual({ TRY: '6000.00', USD: '160.00' });
      expect(money(a.revenue)).toEqual({ TRY: '3490.00', USD: '119.00' });
      expect(money(a.cac)).toEqual({ TRY: '3000.00', USD: '80.00' });
      expect(money(a.cpl)).toEqual({ TRY: '1000.00', USD: '26.67' });
      const roas = ratio(a.roas);
      expect(roas.USD).toBeCloseTo(119 / 160, 10);
      expect(roas.TRY).toBeCloseTo(3490 / 6000, 10);
    });

    it('reports trial to paid from billing data', () => {
      expect(dto.current.trial.trials).toBe(3);
      expect(dto.current.trial.converted).toBe(2);
      expect(dto.current.trial.rate).toBeCloseTo(2 / 3, 10);
      // 10 and 20 days: the median is 15 days.
      expect(dto.current.trial.medianSeconds).toBe(15 * DAY_SECONDS);
    });

    it('lists channel and campaign return, including spend without a paid studio', () => {
      const source = Object.fromEntries(dto.current.channels.bySource.map((r) => [r.key, r]));
      expect(source.meta.studioPaid).toBe(1);
      expect(money(source.meta.spend)).toEqual({ USD: '160.00' });
      expect(money(source.meta.revenue)).toEqual({ USD: '119.00' });
      expect(ratio(source.meta.roas).USD).toBeCloseTo(119 / 160, 10);
      expect(source.google.studioPaid).toBe(1);
      expect(money(source.google.spend)).toEqual({ TRY: '6000.00' });
      expect(money(source.google.revenue)).toEqual({ TRY: '3490.00' });

      const campaign = Object.fromEntries(dto.current.channels.byCampaign.map((r) => [r.key, r]));
      expect(campaign['m3a-cmp-meta-1'].label).toBe('M3a Meta launch');
      expect(campaign['m3a-cmp-meta-1'].studioPaid).toBe(1);
      expect(money(campaign['m3a-cmp-meta-1'].spend)).toEqual({ USD: '150.00' });
      expect(campaign['m3a-cmp-meta-2'].studioPaid).toBe(0);
      expect(ratio(campaign['m3a-cmp-meta-2'].roas)).toEqual({ USD: 0 });
      expect(campaign['m3a-cmp-g-1'].label).toBeNull();
    });

    it('measures channel health: e-mail bounce and complaint, SMS delivery, AI budget, approvals, connection errors', () => {
      const [email7, email30] = dto.health.email;
      expect(email7).toMatchObject({ days: 7, sent: 50, bounced: 3, complained: 1, bounceWarning: true, complaintWarning: true });
      expect(email7.bounceRate).toBeCloseTo(0.06, 10);
      expect(email7.complaintRate).toBeCloseTo(0.02, 10);
      expect(email30).toMatchObject({ days: 30, sent: 200, bounced: 3, complained: 1, bounceWarning: false, complaintWarning: true });
      expect(email30.bounceRate).toBeCloseTo(0.015, 10);

      const [sms7, sms30] = dto.health.sms;
      expect(sms7).toMatchObject({ days: 7, attempted: 9, delivered: 8 });
      expect(sms7.deliveryRate).toBeCloseTo(8 / 9, 10);
      expect(sms30).toMatchObject({ days: 30, attempted: 15, delivered: 14 });

      expect(dto.health.ai).toMatchObject({ budgetCents: 1000, usedMicroUsd: 8_500_000, level: 'warning' });
      expect(dto.health.ai.usedRatio).toBeCloseTo(0.85, 10);
      expect(dto.health.approvals).toEqual({ available: false, pending: 0 });

      expect(dto.health.connections.errorCount).toBe(baselineConnectionErrors + 1);
      const broken = dto.health.connections.items.find((c) => c.label === 'M3a e2e broken');
      expect(broken?.lastError).toContain('Token expired');
      expect(broken?.lastError).not.toContain('ops@example.com');
      expect(broken?.lastError).not.toContain('abcdefXYZ');
      expect(dto.health.connections.items.some((c) => c.label === 'M3a e2e healthy')).toBe(false);
      expect(dto.health.connections.failedDeliveries).toBe(1);
    });

    it('has no comparison block without compare=previous', () => {
      expect(dto.previous).toBeNull();
      expect(dto.deltas).toBeNull();
    });

    it('contains no person-level data', () => {
      const text = JSON.stringify(dto);
      expect(text).not.toContain(MARKER);
      expect(text).not.toContain(PHONE_PREFIX);
    });
  });

  describe('MRR impact', () => {
    it('is present for the super admin and for a caller with platform.referrals.view, computed from plan prices', async () => {
      for (const token of [superAdminToken, readerToken]) {
        const dto = await body(token);
        expect(dto.mrr).toBeDefined();
        // s1 (starter, TRY) and s2 (pro, USD) started paying in March.
        expect(dto.mrr?.newPayingStudios).toBe(2);
        expect(money(dto.mrr!.newMrr)).toEqual({ TRY: starterTryPrice, USD: proUsdPrice });
        const active = money(dto.mrr!.activeMrr);
        expect(Number(active.TRY)).toBeGreaterThanOrEqual(Number(starterTryPrice));
        expect(Number(active.USD)).toBeGreaterThanOrEqual(Number(proUsdPrice));
      }
    });

    it('is omitted for a viewer without platform.referrals.view', async () => {
      const dto = await body(viewerToken);
      expect('mrr' in dto).toBe(false);
      expect(dto.current.acquisition.studioPaid).toBe(2);
    });
  });

  describe('compare=previous', () => {
    let dto: MarketingDashboardDTO;
    beforeAll(async () => {
      dto = await body(superAdminToken, `${QUERY}&compare=previous`);
    });

    it('returns the previous period of equal length and the same current block', () => {
      expect(dto.previous).not.toBeNull();
      expect(dto.previous!.from).toBe('2025-01-29T00:00:00.000Z');
      expect(dto.previous!.to).toBe('2025-02-28T23:59:59.999Z');
      expect(dto.current.acquisition.leads).toBe(6);
    });

    it('computes the previous block from its own period', () => {
      const p = dto.previous!;
      expect(p.acquisition.leads).toBe(2);
      expect(p.acquisition.studioPaid).toBe(1);
      expect(money(p.acquisition.spend)).toEqual({ USD: '50.00' });
      expect(money(p.acquisition.cac)).toEqual({ USD: '50.00' });
      expect(money(p.acquisition.revenue)).toEqual({ USD: '200.00' });
      // Strict funnel: P1 paid without passing MQL and SQL, so the funnel does not count the payment.
      expect(p.funnel.steps.map((s) => s.reached)).toEqual([2, 2, 0, 0, 0, 0]);
      expect(p.trial).toMatchObject({ trials: 1, converted: 1, rate: 1, medianSeconds: 10 * DAY_SECONDS });
    });

    it('returns deltas per figure and per currency', () => {
      const d = dto.deltas!;
      expect(d.leads).toMatchObject({ current: 6, previous: 2, direction: 'up' });
      expect(d.leads.changeRatio).toBeCloseTo(2, 10);
      expect(d.studioPaid).toMatchObject({ current: 2, previous: 1, direction: 'up' });
      expect(d.studioPaid.changeRatio).toBeCloseTo(1, 10);
      const spend = Object.fromEntries(d.spend.map((c) => [c.currency, c]));
      expect(spend.USD).toMatchObject({ current: 160, previous: 50, direction: 'up' });
      expect(spend.USD.changeRatio).toBeCloseTo(2.2, 10);
      // TRY only exists in the current period: no ratio.
      expect(spend.TRY).toMatchObject({ current: 6000, previous: null, changeRatio: null, direction: 'neutral' });
      const cac = Object.fromEntries(d.cac.map((c) => [c.currency, c]));
      expect(cac.USD).toMatchObject({ current: 80, previous: 50, direction: 'up' });
      expect(cac.USD.changeRatio).toBeCloseTo(0.6, 10);
      expect(d.funnel.map((s) => s.key)).toEqual(dto.current.funnel.steps.map((s) => s.key));
      expect(d.funnel[1].reached).toMatchObject({ current: 6, previous: 2, direction: 'up' });
      // Nobody reached MQL before: neutral, no percentage.
      expect(d.funnel[2].reached).toMatchObject({ current: 4, previous: 0, changeRatio: null, direction: 'neutral' });
      expect(d.trials).toMatchObject({ current: 3, previous: 1 });
      expect(d.trialRateDelta).toBeCloseTo(2 / 3 - 1, 10);
    });
  });

  describe('the platform_b2b funnel stays on the platform tenant', () => {
    it('is listed and reportable for the platform tenant only', async () => {
      const own = await asStudio(superAdminToken, PLATFORM).get(`/studios/${PLATFORM}/funnels`);
      expect(own.status).toBe(200);
      expect((own.body.items as Array<{ id: string }>).some((f) => f.id === 'ready.platform_b2b')).toBe(true);

      const zen = await asStudio(ownerToken, ZEN).get(`/studios/${ZEN}/funnels`);
      expect(zen.status).toBe(200);
      expect((zen.body.items as Array<{ id: string }>).some((f) => f.id === 'ready.platform_b2b')).toBe(false);
      const report = await asStudio(ownerToken, ZEN).get(`/studios/${ZEN}/funnels/ready.platform_b2b/report?${QUERY}`);
      expect(report.status).toBe(404);
    });
  });
});
