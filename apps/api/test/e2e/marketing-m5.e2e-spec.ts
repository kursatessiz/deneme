import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { Prisma, PrismaClient } from '@platform/database';
import { mockDkimTokens, normalizePhone } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { AdsHttpClient } from '../../src/modules/ads/ads-http-client';
import { CredentialCipher } from '../../src/common/crypto/credential-cipher';
import { MarketingGuardsService } from '../../src/modules/growth/campaigns/marketing-guards.service';
import { DNS_LOOKUP } from '../../src/modules/platform-marketing/integrations/email-domain-dns';
import { EmailDomainService } from '../../src/modules/platform-marketing/integrations/email-domain.service';
import { MockSesIdentityClient, SES_IDENTITY_PORT, type SesEnsureResult, type SesIdentityInfo, type SesIdentityPort } from '../../src/modules/platform-marketing/integrations/ses-identity.port';

/**
 * M5 (docs/PAZARLAMA_MODULU.md, "M5: Sonra"): the ad spend cap auto-pause
 * (off does nothing; on pauses each active campaign of the platforms that
 * spent once per month, records the audit row and the dashboard block, never
 * resumes, skips a platform without the capability), the SES sender identity
 * automation (provision stores the Easy DKIM tokens and returns the records;
 * the domain check and the heartbeat read the status from SES, DNS-only
 * without it; the mock gives deterministic tokens), and the marketing
 * approval push plus the endpoints the mobile approval screen calls. The ad
 * platforms and SES are fakes at the AdsHttpClient and SES_IDENTITY_PORT
 * seams; nothing leaves the process. Everything created here is removed in
 * afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const PREFIX = '+90539666';
const HOUR = 3_600_000;

/** Numeric ids: the pause requests only accept digits. */
const IDS = { metaA: '5550001', metaB: '5550002', metaPaused: '5550003', metaFail: '5550004', google: '5550005', tiktok: '5550006' } as const;
const ALL_IDS = Object.values(IDS);

/** An IANA zone where it is currently around noon, so the engine's real-clock quiet hours never hold a send. */
function daytimeZone(): string {
  const offset = 12 - new Date().getUTCHours();
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

interface HttpCall {
  platform: string;
  url: string;
  body: unknown;
}

/** The ad platforms: records every write and answers as Meta and Google would. */
class FakeAds {
  readonly forms: HttpCall[] = [];
  readonly posts: HttpCall[] = [];
  readonly gets: string[] = [];
  /** Meta campaign ids whose pause the platform refuses. */
  failing = new Set<string>();
  readonly postForm = jest.fn(async (platform: string, url: string, _headers: Record<string, string>, form: Record<string, string>) => {
    this.forms.push({ platform, url, body: form });
    const id = url.split('/').pop() ?? '';
    return this.failing.has(id)
      ? { ok: false, status: 400, body: { error: { message: 'Campaign cannot be changed' } } }
      : { ok: true, status: 200, body: { success: true } };
  });
  readonly postJson = jest.fn(async (platform: string, url: string, _headers: Record<string, string>, body: unknown) => {
    this.posts.push({ platform, url, body });
    if (new URL(url).hostname === 'oauth2.googleapis.com') return { ok: true, status: 200, body: { access_token: 'e2e-access-token' } };
    return { ok: true, status: 200, body: { results: [{}] } };
  });
  readonly getJson = jest.fn(async (_platform: string, url: string) => {
    this.gets.push(url);
    return { ok: true, status: 200, body: {} };
  });
  reset(): void {
    this.forms.length = 0;
    this.posts.length = 0;
    this.gets.length = 0;
    this.failing.clear();
    this.postForm.mockClear();
    this.postJson.mockClear();
    this.getJson.mockClear();
  }
}

/** SES fake: the mock (deterministic tokens) until a test flips it to a live-looking SES with statuses it controls. */
class FakeSes implements SesIdentityPort {
  provider: 'SES' | 'MOCK' = 'MOCK';
  private readonly mock = new MockSesIdentityClient();
  readonly identities = new Map<string, SesIdentityInfo>();
  ensureCalls = 0;

  tokensFor(domain: string): string[] {
    return mockDkimTokens(`ses-${domain}`);
  }
  async ensureIdentity(domain: string, mailFromDomain: string | null): Promise<SesEnsureResult> {
    this.ensureCalls += 1;
    if (this.provider === 'MOCK') return this.mock.ensureIdentity(domain);
    void mailFromDomain;
    const existing = this.identities.get(domain);
    if (existing) return { created: false, info: existing };
    const info: SesIdentityInfo = { dkimTokens: this.tokensFor(domain), dkimStatus: 'PENDING', verificationStatus: 'PENDING' };
    this.identities.set(domain, info);
    return { created: true, info };
  }
  async getIdentity(domain: string): Promise<SesIdentityInfo | null> {
    return this.identities.get(domain) ?? null;
  }
}

const notFound = (): Error => Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
const emptyDns = {
  resolveTxt: async (): Promise<string[][]> => {
    throw notFound();
  },
  resolveCname: async (): Promise<string[]> => {
    throw notFound();
  },
  resolveMx: async (): Promise<{ exchange: string; priority: number }[]> => {
    throw notFound();
  },
};

describe('Marketing M5 (ad cap auto-pause, SES identity, approval push) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const ads = new FakeAds();
  const ses = new FakeSes();
  const startedAt = new Date();
  const runId = Date.now().toString().slice(-7);

  let PLATFORM: string;
  let superAdminToken: string;
  let superAdminId: string;
  let marketingToken: string;
  let marketingUserId: string;
  let guards: MarketingGuardsService;
  let emailDomains: EmailDomainService;
  let cipher: CredentialCipher;
  let previousMfaPolicy: boolean | undefined;
  let previousStudio: { address: string | null; messagingSettings: Prisma.JsonValue };
  let walletExisted = false;
  let previousWallet = 0;
  let segmentId: string;
  const templateKey = `M5_SMS_${runId}`;
  const marketingPhone = normalizePhone(`0535${runId}`)!;
  const contactIds: string[] = [];
  const campaignIds: string[] = [];
  const domainName = `m5-${runId}.example.com`;
  const deviceToken = `ExponentPushToken[m5e2e${runId}]`;
  const monthKey = `${startedAt.getUTCFullYear()}-${String(startedAt.getUTCMonth() + 1).padStart(2, '0')}`;
  const monthStart = new Date(Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), 1));

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`),
  });
  const tenant = (token: string, studioId: string) => ({
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const settings = (body: Record<string, unknown>) => as(superAdminToken).patch('/admin/marketing/settings').send(body);
  const dashboardCaps = async () => {
    const res = await as(superAdminToken).get('/platform/marketing/dashboard');
    expect(res.status).toBe(200);
    return res.body.health.adSpendCaps as Array<{
      currency: string;
      cap: string;
      spent: string;
      exceeded: boolean;
      autoPause: boolean;
      pauses: Array<{ platform: string; campaignExternalId: string; campaignName: string; status: string; attempts: number; lastError: string | null; currency: string; month: string }>;
    }>;
  };
  const entity = (platform: string, externalId: string) => prisma.adEntity.findUniqueOrThrow({ where: { studioId_platform_level_externalId: { studioId: PLATFORM, platform, level: 'CAMPAIGN', externalId } } });
  const pauseRow = (platform: string, externalId: string) =>
    prisma.adCapPause.findUnique({ where: { studioId_platform_campaignExternalId_monthKey: { studioId: PLATFORM, platform, campaignExternalId: externalId, monthKey } } });
  const pauseAudits = (action: string) => prisma.auditLog.findMany({ where: { studioId: PLATFORM, action, createdAt: { gte: startedAt } } });

  async function seedAdData(): Promise<void> {
    const status: Record<string, [string, string]> = {
      [IDS.metaA]: ['META', 'ACTIVE'],
      [IDS.metaB]: ['META', 'ACTIVE'],
      [IDS.metaPaused]: ['META', 'PAUSED'],
      [IDS.metaFail]: ['META', 'ACTIVE'],
      [IDS.google]: ['GOOGLE', 'ENABLED'],
      [IDS.tiktok]: ['TIKTOK', 'ENABLE'],
    };
    for (const [externalId, [platform, st]] of Object.entries(status)) {
      await prisma.adEntity.create({ data: { studioId: PLATFORM, platform, level: 'CAMPAIGN', externalId, name: `M5 e2e ${platform} ${externalId}`, status: st } });
      await prisma.adSpendDaily.create({
        data: { studioId: PLATFORM, platform, level: 'CAMPAIGN', externalId, date: monthStart, spendAmount: new Prisma.Decimal('40.00'), currency: 'USD' },
      });
    }
    const metaCreds = cipher.encrypt(JSON.stringify({ accessToken: 'EAAB-m5-e2e-token', pixelId: '123456789012345' }));
    const googleCreds = cipher.encrypt(
      JSON.stringify({
        clientId: 'cid',
        clientSecret: 'csecret',
        refreshToken: 'rtoken',
        developerToken: 'dtoken',
        loginCustomerId: '1234567890',
        customerId: '1234567890',
        conversionId: 'AW-123456789',
      }),
    );
    await prisma.adConnection.createMany({
      data: [
        { studioId: PLATFORM, platform: 'META', label: 'M5 e2e Meta', status: 'CONNECTED', externalAccountId: 'act_5550', encryptedCredentials: metaCreds, credentialLast4: '0000' },
        { studioId: PLATFORM, platform: 'GOOGLE', label: 'M5 e2e Google', status: 'CONNECTED', externalAccountId: '1234567890', encryptedCredentials: googleCreds, credentialLast4: '0000' },
      ],
    });
  }

  async function makeContact(n: number): Promise<string> {
    const contact = await prisma.contact.create({
      data: { studioId: PLATFORM, firstName: `M5${n}`, lastName: 'M5Marker', phone: `${PREFIX}${String(n).padStart(4, '0')}`, countryCode: 'TR', timezone: daytimeZone(), locale: 'tr', lifecycleStage: 'LEAD' },
    });
    await prisma.contactConsent.create({ data: { studioId: PLATFORM, contactId: contact.id, channel: 'SMS', status: 'GRANTED', source: 'e2e', grantedAt: new Date() } });
    contactIds.push(contact.id);
    return contact.id;
  }

  async function newCampaign(name: string): Promise<string> {
    const res = await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/campaigns`).send({ name: `M5 e2e ${name}`, segmentId, channel: 'SMS', templateKey });
    expect(res.status).toBe(201);
    campaignIds.push(res.body.id);
    return res.body.id as string;
  }

  async function cleanup(): Promise<void> {
    const campaigns = await prisma.campaign.findMany({ where: { studioId: PLATFORM, name: { startsWith: 'M5 e2e' } }, select: { id: true } });
    const ids = [...new Set([...campaigns.map((c) => c.id), ...campaignIds])];
    const contacts = await prisma.contact.findMany({ where: { studioId: PLATFORM, lastName: 'M5Marker' }, select: { id: true } });
    const cids = contacts.map((c) => c.id);
    const domains = await prisma.emailSenderDomain.findMany({ where: { studioId: PLATFORM, domain: domainName }, select: { id: true } });
    const entities = await prisma.adEntity.findMany({ where: { studioId: PLATFORM, externalId: { in: ALL_IDS } }, select: { id: true } });
    await prisma.approvalRequest.deleteMany({ where: { studioId: PLATFORM, targetId: { in: ids } } });
    await prisma.notificationLog.deleteMany({
      where: {
        OR: [
          { campaignId: { in: ids } },
          { contactId: { in: cids } },
          { studioId: PLATFORM, type: { in: ['MARKETING_APPROVAL_REQUESTED', 'MARKETING_APPROVAL_REQUESTED_PUSH', 'MARKETING_APPROVAL_APPROVED', 'MARKETING_APPROVAL_REJECTED', 'MARKETING_AD_CAP_EXCEEDED'] }, createdAt: { gte: startedAt } },
        ],
      },
    });
    await prisma.campaign.deleteMany({ where: { id: { in: ids } } });
    await prisma.segment.deleteMany({ where: { studioId: PLATFORM, name: { startsWith: 'M5 e2e' } } });
    await prisma.contact.deleteMany({ where: { id: { in: cids } } });
    await prisma.messageTemplate.deleteMany({ where: { studioId: PLATFORM, key: { startsWith: 'M5_' } } });
    await prisma.adCapPause.deleteMany({ where: { studioId: PLATFORM, campaignExternalId: { in: ALL_IDS } } });
    await prisma.adSpendDaily.deleteMany({ where: { studioId: PLATFORM, externalId: { in: ALL_IDS } } });
    await prisma.adEntity.deleteMany({ where: { studioId: PLATFORM, externalId: { in: ALL_IDS } } });
    await prisma.adConnection.deleteMany({ where: { studioId: PLATFORM, label: { startsWith: 'M5 e2e' } } });
    await prisma.emailSenderDomain.deleteMany({ where: { studioId: PLATFORM, domain: domainName } });
    await prisma.pushDevice.deleteMany({ where: { token: deviceToken } });
    await prisma.marketingSettings.deleteMany({ where: { studioId: PLATFORM } });
    // The once-a-month cap alert of any earlier run or spec would silence this suite's alert.
    await prisma.auditLog.deleteMany({ where: { studioId: PLATFORM, action: 'marketing.alert.sent', entityId: { startsWith: `ad_cap:USD:${monthKey}` } } });
    await prisma.auditLog.deleteMany({
      where: {
        studioId: PLATFORM,
        createdAt: { gte: startedAt },
        OR: [
          { action: { startsWith: 'marketing.approval.' } },
          { action: { startsWith: 'marketing.campaign.' } },
          { action: { startsWith: 'marketing.ad_campaign.' } },
          { action: 'marketing.settings.updated' },
          { action: 'marketing.sender_domain.ses_provisioned' },
          { entityId: { in: [...domains.map((d) => d.id), ...entities.map((e) => e.id)] } },
        ],
      },
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AdsHttpClient)
      .useValue(ads)
      .overrideProvider(SES_IDENTITY_PORT)
      .useValue(ses)
      .overrideProvider(DNS_LOOKUP)
      .useValue(emptyDns)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    guards = app.get(MarketingGuardsService, { strict: false });
    emailDomains = app.get(EmailDomainService, { strict: false });
    cipher = app.get(CredentialCipher, { strict: false });

    const platform = await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } });
    PLATFORM = platform.id;
    previousStudio = { address: platform.address, messagingSettings: platform.messagingSettings };
    await cleanup();

    await prisma.studio.update({ where: { id: PLATFORM }, data: { messagingSettings: { frequencyCap: { perDay: 50, perWeek: 200 } }, address: 'M5 e2e adres 1' } });
    const wallet = await prisma.smsWallet.findUnique({ where: { studioId: PLATFORM } });
    walletExisted = Boolean(wallet);
    previousWallet = wallet?.balance ?? 0;
    await prisma.smsWallet.upsert({ where: { studioId: PLATFORM }, create: { studioId: PLATFORM, balance: 1000 }, update: { balance: 1000 } });
    await prisma.messageTemplate.create({
      data: { studioId: PLATFORM, key: templateKey, channel: 'SMS', locale: 'tr', body: 'Merhaba {firstName}, M5 deneme mesaji. Cikis icin RET yazin.', isTransactional: false, isActive: true },
    });

    const previous = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
    previousMfaPolicy = previous?.require2faForPlatformRoles;
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', require2faForPlatformRoles: false }, update: { require2faForPlatformRoles: false } });
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const marketingRole = await prisma.platformRoleTemplate.findUniqueOrThrow({ where: { key: 'marketing_admin' } });
    const marketing = await prisma.user.create({ data: { phone: marketingPhone, firstName: 'Pazarlama', lastName: 'M5Talep', passwordHash, phoneVerifiedAt: new Date() } });
    marketingUserId = marketing.id;
    await prisma.platformMembership.create({ data: { userId: marketing.id, roleTemplateId: marketingRole.id, status: 'ACTIVE', activatedAt: new Date() } });

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    superAdminId = (await prisma.user.findUniqueOrThrow({ where: { phone: SUPER_ADMIN_PHONE } })).id;
    marketingToken = await login(marketingPhone);

    const members = [await makeContact(0), await makeContact(1)];
    const seg = await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/segments`).send({ name: 'M5 e2e segment', kind: 'STATIC' });
    expect(seg.status).toBe(201);
    segmentId = seg.body.id;
    expect((await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/segments/${segmentId}/members`).send({ add: members })).status).toBe(201);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.studio.update({
      where: { id: PLATFORM },
      data: { address: previousStudio.address, messagingSettings: (previousStudio.messagingSettings ?? {}) as Prisma.InputJsonValue },
    });
    if (walletExisted) await prisma.smsWallet.update({ where: { studioId: PLATFORM }, data: { balance: previousWallet } });
    else await prisma.smsWallet.deleteMany({ where: { studioId: PLATFORM } });
    await prisma.notificationLog.deleteMany({ where: { userId: marketingUserId } });
    await prisma.auditLog.deleteMany({ where: { userId: marketingUserId } });
    await prisma.user.deleteMany({ where: { id: marketingUserId } });
    if (previousMfaPolicy !== undefined) {
      await prisma.platformAccessSettings.update({ where: { id: 'platform' }, data: { require2faForPlatformRoles: previousMfaPolicy } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('ad spend cap auto-pause', () => {
    beforeAll(async () => {
      await seedAdData();
    });
    beforeEach(() => ads.reset());

    it('is off by default: an exceeded cap alerts and shows red but pauses nothing', async () => {
      const view = await as(superAdminToken).get('/admin/marketing/settings');
      expect(view.body.settings.adCapAutoPause).toBe(false);
      // 6 campaigns x 40 USD = 240 USD against a 100 USD cap.
      expect((await settings({ monthlyAdSpendCaps: { USD: '100.00' } })).status).toBe(200);
      const run = await guards.runAdSpendCapsDetailed(new Date());
      expect(run).toMatchObject({ adCapPaused: 0, adCapPauseFailed: 0 });
      expect(ads.postForm).not.toHaveBeenCalled();
      expect(ads.postJson).not.toHaveBeenCalled();
      expect(await prisma.adCapPause.count({ where: { studioId: PLATFORM, campaignExternalId: { in: ALL_IDS } } })).toBe(0);
      expect((await entity('META', IDS.metaA)).status).toBe('ACTIVE');

      const [usd] = await dashboardCaps();
      expect(usd).toMatchObject({ currency: 'USD', exceeded: true, autoPause: false, pauses: [] });
      const alert = await prisma.notificationLog.findFirst({ where: { studioId: PLATFORM, userId: superAdminId, channel: 'IN_APP', type: 'MARKETING_AD_CAP_EXCEEDED', createdAt: { gte: startedAt } } });
      expect(alert?.content).toContain('otomatik durdurulmaz');
    });

    it('the setting is validated and audit logged', async () => {
      expect((await settings({ adCapAutoPause: 'yes' })).status).toBe(400);
      const res = await settings({ adCapAutoPause: true });
      expect(res.status).toBe(200);
      expect(res.body.settings.adCapAutoPause).toBe(true);
      const audit = await prisma.auditLog.findFirst({ where: { studioId: PLATFORM, action: 'marketing.settings.updated', userId: superAdminId }, orderBy: { createdAt: 'desc' } });
      expect(audit?.metadata).toMatchObject({ changes: { adCapAutoPause: { from: false, to: true } } });
    });

    it('on: pauses each active campaign of the platforms that spent once, records audit rows and the dashboard block, skips what it cannot pause', async () => {
      ads.failing.add(IDS.metaFail);
      const run = await guards.runAdSpendCapsDetailed(new Date());
      // Meta A and B and Google are paused; the refused one fails; the paused one and TikTok are left alone.
      expect(run).toMatchObject({ adCapPaused: 3, adCapPauseFailed: 1 });

      const metaUrls = ads.forms.map((c) => c.url);
      expect(metaUrls.some((u) => u.endsWith(`/${IDS.metaA}`))).toBe(true);
      expect(metaUrls.some((u) => u.endsWith(`/${IDS.metaB}`))).toBe(true);
      expect(metaUrls.some((u) => u.endsWith(`/${IDS.metaPaused}`))).toBe(false);
      expect(ads.forms.every((c) => (c.body as Record<string, string>).status === 'PAUSED')).toBe(true);
      const mutate = ads.posts.find((c) => c.url.includes('campaigns:mutate'));
      expect(mutate?.url).toContain(`/customers/1234567890/`);
      expect(JSON.stringify(mutate?.body)).toContain(`customers/1234567890/campaigns/${IDS.google}`);
      expect([...ads.forms, ...ads.posts].some((c) => c.platform === 'TIKTOK')).toBe(false);

      for (const [platform, id] of [['META', IDS.metaA], ['META', IDS.metaB], ['GOOGLE', IDS.google]] as const) {
        expect((await pauseRow(platform, id))?.status).toBe('PAUSED');
        expect((await entity(platform, id)).status).toBe('PAUSED');
      }
      expect((await entity('TIKTOK', IDS.tiktok)).status).toBe('ENABLE');
      expect(await pauseRow('TIKTOK', IDS.tiktok)).toBeNull();
      expect(await pauseRow('META', IDS.metaPaused)).toBeNull();
      const failed = await pauseRow('META', IDS.metaFail);
      expect(failed).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect(failed?.lastError).toContain('400');

      const audits = await pauseAudits('marketing.ad_campaign.auto_paused');
      expect(audits).toHaveLength(3);
      expect(audits.map((a) => a.entityId).sort()).toEqual([(await entity('META', IDS.metaA)).id, (await entity('META', IDS.metaB)).id, (await entity('GOOGLE', IDS.google)).id].sort());
      expect(audits[0]?.metadata).toMatchObject({ reason: 'AD_SPEND_CAP_EXCEEDED', currency: 'USD', month: monthKey, cap: '100.00' });
      expect(await pauseAudits('marketing.ad_campaign.auto_pause_failed')).toHaveLength(1);

      const [usd] = await dashboardCaps();
      expect(usd).toMatchObject({ currency: 'USD', exceeded: true, autoPause: true });
      expect(usd?.pauses.filter((p) => p.status === 'PAUSED').map((p) => p.campaignExternalId).sort()).toEqual([IDS.metaA, IDS.metaB, IDS.google]);
      expect(usd?.pauses.find((p) => p.campaignExternalId === IDS.metaFail)).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect(usd?.pauses.every((p) => p.month === monthKey && p.currency === 'USD')).toBe(true);
    });

    it('is idempotent: a paused campaign is never paused again, even when the spend sync reports it active; a failed one is retried', async () => {
      // The Meta spend sync stores every campaign as ACTIVE; the month's pause record still wins.
      ads.failing.add(IDS.metaFail);
      await prisma.adEntity.updateMany({ where: { studioId: PLATFORM, platform: 'META', externalId: { in: [IDS.metaA, IDS.metaB] } }, data: { status: 'ACTIVE' } });
      const again = await guards.runAdSpendCapsDetailed(new Date());
      expect(again).toMatchObject({ adCapPaused: 0, adCapPauseFailed: 1 });
      expect(ads.forms.map((c) => c.url.split('/').pop())).toEqual([IDS.metaFail]);
      expect(ads.posts).toHaveLength(0);
      expect(await pauseAudits('marketing.ad_campaign.auto_paused')).toHaveLength(3);
      expect(await pauseRow('META', IDS.metaFail)).toMatchObject({ status: 'FAILED', attempts: 2 });
      // Only the first failure of the month is audited.
      expect(await pauseAudits('marketing.ad_campaign.auto_pause_failed')).toHaveLength(1);

      // The platform accepts it now: the retry pauses it and it is left alone from then on.
      ads.failing.clear();
      const retry = await guards.runAdSpendCapsDetailed(new Date());
      expect(retry).toMatchObject({ adCapPaused: 1, adCapPauseFailed: 0 });
      expect(await pauseRow('META', IDS.metaFail)).toMatchObject({ status: 'PAUSED', attempts: 3 });
      expect(await pauseAudits('marketing.ad_campaign.auto_paused')).toHaveLength(4);
      ads.reset();
      expect(await guards.runAdSpendCapsDetailed(new Date())).toMatchObject({ adCapPaused: 0, adCapPauseFailed: 0 });
      expect(ads.postForm).not.toHaveBeenCalled();
    });

    it('never resumes: dropping below the cap or switching the setting off leaves the paused campaigns paused', async () => {
      expect((await settings({ adCapAutoPause: false, monthlyAdSpendCaps: { USD: '100000.00' } })).status).toBe(200);
      expect(await guards.runAdSpendCapsDetailed(new Date())).toMatchObject({ adCapPaused: 0 });
      expect(ads.postForm).not.toHaveBeenCalled();
      expect(ads.postJson).not.toHaveBeenCalled();
      expect((await pauseRow('META', IDS.metaA))?.status).toBe('PAUSED');
      const [usd] = await dashboardCaps();
      expect(usd).toMatchObject({ exceeded: false, autoPause: false });
      expect(usd?.pauses).toHaveLength(4);
    });

    it('a platform tenant only: the block is empty without caps', async () => {
      expect((await settings({ monthlyAdSpendCaps: {} })).status).toBe(200);
      expect(await dashboardCaps()).toEqual([]);
    });
  });

  describe('SES sender identity automation', () => {
    let domainId: string;

    it('the domain is added without hand-copied tokens and only a super admin can provision it', async () => {
      const created = await as(superAdminToken).post('/platform/integrations/email-domains').set('x-platform-entry', 'admin').send({ domain: domainName, purpose: 'MARKETING' });
      expect(created.status).toBe(201);
      domainId = created.body.id;
      expect(created.body).toMatchObject({ sesProvisionedAt: null, sesVerificationStatus: null });
      expect((await as(marketingToken).post(`/admin/marketing/sender-domains/${domainId}/provision`)).status).toBe(403);
      expect((await request(server).post(`/admin/marketing/sender-domains/${domainId}/provision`)).status).toBe(401);
      expect((await as(superAdminToken).post('/admin/marketing/sender-domains/00000000-0000-4000-8000-000000000000/provision')).status).toBe(404);
    });

    it('without SES credentials (mock) it returns deterministic fake tokens', async () => {
      const first = await as(superAdminToken).post(`/admin/marketing/sender-domains/${domainId}/provision`);
      expect(first.status).toBe(200);
      expect(first.body.provider).toBe('MOCK');
      const expected = mockDkimTokens(domainName);
      expect(first.body.records.filter((r: { kind: string }) => r.kind === 'DKIM').map((r: { value: string }) => r.value)).toEqual(expected.map((t) => `${t}.dkim.amazonses.com`));
      const stored = await prisma.emailSenderDomain.findUniqueOrThrow({ where: { id: domainId } });
      expect(stored.dkimTokens).toEqual(expected);
      expect(stored.sesProvisionedAt).not.toBeNull();
    });

    it('with SES configured it creates the identity with Easy DKIM, stores the tokens and returns the records to publish', async () => {
      ses.provider = 'SES';
      const res = await as(superAdminToken).post(`/admin/marketing/sender-domains/${domainId}/provision`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ provider: 'SES', created: true });
      const tokens = ses.tokensFor(domainName);
      const dkim = res.body.records.filter((r: { kind: string }) => r.kind === 'DKIM');
      expect(dkim.map((r: { name: string }) => r.name)).toEqual(tokens.map((t) => `${t}._domainkey.${domainName}`));
      expect(dkim.map((r: { value: string }) => r.value)).toEqual(tokens.map((t) => `${t}.dkim.amazonses.com`));
      expect(res.body.records.some((r: { kind: string }) => r.kind === 'SPF')).toBe(true);
      expect(res.body.domain).toMatchObject({ dkimStatus: 'MISSING', sesVerificationStatus: 'PENDING', verified: false });
      const stored = await prisma.emailSenderDomain.findUniqueOrThrow({ where: { id: domainId } });
      expect(stored.dkimTokens).toEqual(tokens);
      const audit = await prisma.auditLog.findFirst({ where: { studioId: PLATFORM, action: 'marketing.sender_domain.ses_provisioned', entityId: domainId } });
      expect(audit).toMatchObject({ userId: superAdminId });

      const again = await as(superAdminToken).post(`/admin/marketing/sender-domains/${domainId}/provision`);
      expect(again.body).toMatchObject({ provider: 'SES', created: false });
    });

    it('the heartbeat reads the DKIM and verification status from SES', async () => {
      const identity = ses.identities.get(domainName)!;
      // Still pending at SES: nothing changes (never checked domains are due right away).
      const first = await emailDomains.processDue(new Date());
      expect(first.checked).toBeGreaterThanOrEqual(1);
      expect((await prisma.emailSenderDomain.findUniqueOrThrow({ where: { id: domainId } })).dkimStatus).toBe('MISSING');

      identity.dkimStatus = 'SUCCESS';
      identity.verificationStatus = 'SUCCESS';
      // An unverified domain is due again an hour later.
      await emailDomains.processDue(new Date(Date.now() + 2 * HOUR));
      const row = await prisma.emailSenderDomain.findUniqueOrThrow({ where: { id: domainId } });
      expect(row).toMatchObject({ dkimStatus: 'VALID', sesVerificationStatus: 'SUCCESS' });
      // SPF and DMARC still come from DNS (nothing published in the fake zone).
      expect(row.spfStatus).toBe('MISSING');
      const audit = await prisma.auditLog.findMany({ where: { studioId: PLATFORM, action: 'integration.email_domain.check', entityId: domainId } });
      expect(audit.some((a) => (a.metadata as { via?: string } | null)?.via === 'heartbeat' && (a.metadata as { dkim?: string }).dkim === 'VALID')).toBe(true);
    });

    it('the manual check uses SES for DKIM too, and falls back to DNS only when SES cannot answer', async () => {
      const checked = await as(superAdminToken).post(`/platform/integrations/email-domains/${domainId}/check`).set('x-platform-entry', 'admin');
      expect(checked.status).toBe(200);
      expect(checked.body).toMatchObject({ dkimStatus: 'VALID', sesVerificationStatus: 'SUCCESS' });
      expect(checked.body.expectedRecords.filter((r: { kind: string }) => r.kind === 'DKIM').every((r: { status: string }) => r.status === 'VALID')).toBe(true);

      // Back to no SES credentials: the DNS lookup decides (nothing published, so DKIM is missing again).
      ses.provider = 'MOCK';
      const dnsOnly = await as(superAdminToken).post(`/platform/integrations/email-domains/${domainId}/check`).set('x-platform-entry', 'admin');
      expect(dnsOnly.status).toBe(200);
      expect(dnsOnly.body.dkimStatus).toBe('MISSING');
    });
  });

  describe('approval push and the endpoints of the mobile approval screen', () => {
    beforeAll(async () => {
      // Every request waits for a super admin, whatever its size.
      expect((await settings({ selfApproveSmsMax: 1 })).status).toBe(200);
      await prisma.pushDevice.create({ data: { userId: superAdminId, token: deviceToken, platform: 'ios', deviceName: 'M5 e2e' } });
    });

    it('a new request pushes to the approver with a device, and only to approvers', async () => {
      const campaignId = await newCampaign('push');
      const before = new Date();
      const req = await as(marketingToken).post(`/platform/marketing/campaigns/${campaignId}/request-approval`).send({});
      expect(req.status).toBe(200);
      expect(req.body.request).toMatchObject({ status: 'PENDING', canDecide: false });
      const requestId = req.body.request.id as string;

      const push = await prisma.notificationLog.findFirst({ where: { studioId: PLATFORM, userId: superAdminId, channel: 'PUSH', type: 'MARKETING_APPROVAL_REQUESTED_PUSH', createdAt: { gte: before } } });
      expect(push).not.toBeNull();
      expect(push?.status).toBe('SENT');
      expect(`${push?.subject ?? ''} ${push?.content ?? ''}`).toContain('M5 e2e push');
      // The requester is not an approver: no push for them.
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM, userId: marketingUserId, channel: 'PUSH', createdAt: { gte: before } } })).toBe(0);
      // The e-mail and in-app notices are unchanged.
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM, userId: superAdminId, channel: 'IN_APP', type: 'MARKETING_APPROVAL_REQUESTED', createdAt: { gte: before } } })).toBe(1);

      // The screen lists it with the summary it shows.
      const list = await as(superAdminToken).get('/platform/marketing/approvals?status=PENDING&limit=50');
      expect(list.status).toBe(200);
      const item = list.body.items.find((i: { id: string }) => i.id === requestId);
      expect(item).toMatchObject({ status: 'PENDING', canDecide: true, requestedBy: { id: marketingUserId } });
      expect(item.summary.target.name).toBe('M5 e2e push');
      expect(item.summary.audience.total).toBe(2);
      expect(typeof item.expiresAt).toBe('string');
      expect(list.body.pendingCount).toBeGreaterThanOrEqual(1);
    });

    it('with no registered device the approver simply gets no push (best effort, the request still goes through)', async () => {
      await prisma.pushDevice.deleteMany({ where: { token: deviceToken } });
      const campaignId = await newCampaign('cihazsiz');
      const before = new Date();
      const req = await as(marketingToken).post(`/platform/marketing/campaigns/${campaignId}/request-approval`).send({});
      expect(req.status).toBe(200);
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM, userId: superAdminId, channel: 'PUSH', status: 'SENT', createdAt: { gte: before } } })).toBe(0);
      expect(await prisma.notificationLog.count({ where: { studioId: PLATFORM, userId: superAdminId, channel: 'IN_APP', type: 'MARKETING_APPROVAL_REQUESTED', createdAt: { gte: before } } })).toBe(1);
    });

    it('approve without a note (the screen sends an empty body), reject needs a reason; the requester cannot decide', async () => {
      const pending = await prisma.approvalRequest.findMany({ where: { studioId: PLATFORM, status: 'PENDING', targetId: { in: campaignIds } }, orderBy: { createdAt: 'asc' } });
      expect(pending).toHaveLength(2);
      const [first, second] = pending;

      expect((await as(marketingToken).post(`/platform/marketing/approvals/${first!.id}/approve`).send({})).status).toBe(403);
      const approved = await as(superAdminToken).post(`/platform/marketing/approvals/${first!.id}/approve`).send({});
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', decidedBy: { id: superAdminId }, decisionNote: null });
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: first!.targetId } })).status).toBe('SCHEDULED');

      expect((await as(superAdminToken).post(`/platform/marketing/approvals/${second!.id}/reject`).send({})).status).toBe(400);
      const rejected = await as(superAdminToken).post(`/platform/marketing/approvals/${second!.id}/reject`).send({ note: 'Kitle fazla genis' });
      expect(rejected.status).toBe(200);
      expect(rejected.body).toMatchObject({ status: 'REJECTED', decisionNote: 'Kitle fazla genis' });
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: second!.targetId } })).status).toBe('DRAFT');

      const after = await as(superAdminToken).get('/platform/marketing/approvals?status=PENDING&limit=50');
      expect(after.body.items.some((i: { id: string }) => i.id === first!.id || i.id === second!.id)).toBe(false);
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: { in: ['marketing.approval.approved', 'marketing.approval.rejected'] }, entityId: { in: [first!.id, second!.id] } } })).toBe(2);
    });

    it('the platform context the app reads for the menu reports the approve permission for the super admin only', async () => {
      const admin = await as(superAdminToken).get('/platform/context');
      expect(admin.status).toBe(200);
      expect(admin.body.permissions).toContain('platform.marketing.approve');
      const member = await as(marketingToken).get('/platform/context');
      expect(member.status).toBe(200);
      expect(member.body.permissions).not.toContain('platform.marketing.approve');
    });
  });
});
