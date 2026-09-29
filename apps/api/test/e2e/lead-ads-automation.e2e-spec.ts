import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'crypto';
import { Prisma, PrismaClient } from '@platform/database';
import { PLATFORM_WEBHOOK_EVENTS, normalizePhone } from '@platform/shared';
import type { IntegrationHubDTO, MetaLead } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { configureBodyParsers } from '../../src/common/body-parsers';
import { FakeMetaGraphClient } from '../../src/modules/lead-ads/fake-meta-graph.client';
import { META_GRAPH_CLIENT } from '../../src/modules/lead-ads/meta-graph.client';
import { deterministicUuid } from '../../src/modules/lead-ads/lead-ads.service';
import { signMetaBody } from '../../src/modules/messaging/webhooks/whatsapp-signature';
import { IysClientAdapter } from '../../src/modules/notifications/consent/iys-client.adapter';
import { MessagingService } from '../../src/modules/messaging/engine/messaging.service';
import type { SendMessageInput } from '../../src/modules/messaging/engine/messaging.types';
import { BillingJobsService } from '../../src/modules/billing/billing-jobs.service';
import { WebhookDispatcherService } from '../../src/modules/webhooks/webhook-dispatcher.service';
import { buildSignatureHeader, verifySignatureHeader } from '../../src/modules/webhooks/webhook-signature';

/**
 * M4c inbound leads and automation (docs/PAZARLAMA_MODULU.md 5.2, 8):
 * the Meta Lead Ads webhook (handshake, signature, one contact + lead
 * conversion + touchpoint + consent per lead, duplicates ignored, retries),
 * the hub blocks and their permissions, the public write API for Zapier,
 * Make and n8n (crm.write scope, Idempotency-Key, tags, consent with legal
 * basis under the M3e rules) and the platform events, which reach only the
 * platform tenant's subscriptions. The Graph API and the webhook delivery
 * are faked, so nothing here calls Meta or a remote host. Everything created
 * here is removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const ZEN_OWNER_PHONE = '+905321000002';
const FLOW_OWNER_PHONE = '+905321000022';
const MINUTE = 60_000;
const DAY = 24 * 60 * 60 * 1000;
const VERIFY_TOKEN = 'm4c-e2e-verify-token-1234567890';
const APP_SECRET = 'm4c-e2e-meta-app-secret-abcdef123456';
const MARKER = 'M4cMarker';
const EMAIL_DOMAIN = 'm4c-e2e.example';
const SLUG = 'e2e-m4c';
const PLAN_KEY = 'e2e-m4c-plan';
const TENANT_PHONE_PREFIX = '+9053977';

describe('Lead ads and automation (M4c) e2e', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let messaging: MessagingService;
  let sendSpy: jest.SpyInstance<ReturnType<MessagingService['send']>, [SendMessageInput]>;
  let deliverSpy: jest.SpyInstance;
  const graph = new FakeMetaGraphClient();
  const iysMock = { syncConsent: jest.fn(async () => ({ success: true, transactionId: 'mock-m4c' })) };
  const startedAt = new Date();
  const runId = String(randomInt(1_000_000, 9_999_999));

  const PAGE = `71${runId}`;
  const FORM_CONSENT = `72${runId}`;
  const FORM_PLAIN = `73${runId}`;
  const leadgenIds: string[] = [];
  let leadgenSeq = 0;
  const newLeadgenId = () => {
    const id = `74${runId}${String(++leadgenSeq).padStart(3, '0')}`;
    leadgenIds.push(id);
    return id;
  };

  let PLATFORM: string;
  let ZEN: string;
  let FLOW: string;
  let superAdminToken: string;
  let marketingToken: string;
  let zenOwnerToken: string;
  let flowOwnerToken: string;
  let connectionId: string;
  let previousMfaPolicy: boolean | undefined;
  let previousSettings: { leadgenVerifyTokenHash: string | null; leadgenVerifyTokenLast4: string | null; leadgenVerifyTokenSetAt: Date | null } | null = null;
  let previousPlatformMessaging: Prisma.JsonValue;
  const marketingPhone = normalizePhone(`0535${runId}`)!;
  const createdUserPhones = [marketingPhone];
  const apiKeyIds: string[] = [];
  const endpointIds: string[] = [];
  const campaignIds: string[] = [];
  const segmentIds: string[] = [];

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`),
  });
  const tenant = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const withKey = (key: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${key}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${key}`),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${key}`),
  });
  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const runScheduler = (now: Date) => as(superAdminToken).post('/admin/scheduler/run').send({ now: now.toISOString() });
  const hub = async (token = superAdminToken) => {
    const res = await as(token).get('/platform/integrations');
    expect(res.status).toBe(200);
    return res.body as IntegrationHubDTO;
  };

  // -- Lead Ads helpers ------------------------------------------------------

  const notification = (leadgenId: string, formId: string, pageId = PAGE) => ({
    object: 'page',
    entry: [{ id: pageId, time: Math.floor(Date.now() / 1000), changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: pageId, form_id: formId, ad_id: '333', created_time: Math.floor(Date.now() / 1000) } }] }],
  });
  const postLeadgen = (payload: unknown, secret: string | null = APP_SECRET, headerOverride?: string) => {
    const raw = JSON.stringify(payload);
    const req = request(server).post('/webhooks/meta/leadgen').set('Content-Type', 'application/json');
    const header = headerOverride ?? (secret ? signMetaBody(raw, secret) : undefined);
    if (header) req.set('X-Hub-Signature-256', header);
    return req.send(raw);
  };
  const lead = (id: string, formId: string, fields: Record<string, string[]>): MetaLead => ({
    id,
    created_time: new Date().toISOString(),
    ad_id: '333',
    adset_id: '444',
    campaign_id: '555',
    form_id: formId,
    field_data: Object.entries(fields).map(([name, values]) => ({ name, values })),
  });
  const event = (leadgenId: string) => prisma.leadAdEvent.findUniqueOrThrow({ where: { studioId_leadgenId: { studioId: PLATFORM, leadgenId } } });
  const confirmLinks = () =>
    sendSpy.mock.calls
      .map(([input]) => input)
      .filter((input) => input.templateKey === 'CONSENT_CONFIRMATION')
      .map((input) => ({ contactId: 'contactId' in input.recipient ? input.recipient.contactId : null, link: String(input.variables?.link ?? '') }));

  // -- Cleanup -----------------------------------------------------------------

  async function cleanup(): Promise<void> {
    const contacts = await prisma.contact.findMany({
      where: { studioId: { in: [PLATFORM, ZEN, FLOW] }, OR: [{ email: { endsWith: `@${EMAIL_DOMAIN}` } }, { lastName: MARKER }] },
      select: { id: true },
    });
    const cids = contacts.map((c) => c.id);
    const visitorIds = leadgenIds.map((id) => deterministicUuid(`lead-ad-visitor:${id}`));
    await prisma.notificationLog.deleteMany({ where: { OR: [{ contactId: { in: cids } }, { campaignId: { in: campaignIds } }] } });
    await prisma.touchpoint.deleteMany({ where: { OR: [{ contactId: { in: cids } }, { visitorId: { in: visitorIds } }] } });
    await prisma.visitor.deleteMany({ where: { id: { in: visitorIds } } });
    await prisma.conversionEvent.deleteMany({ where: { contactId: { in: cids } } });
    await prisma.messageSuppression.deleteMany({ where: { contactId: { in: cids } } });
    await prisma.contact.deleteMany({ where: { id: { in: cids } } });
    await prisma.leadAdEvent.deleteMany({ where: { studioId: PLATFORM, pageId: PAGE } });
    await prisma.leadAdFormMapping.deleteMany({ where: { studioId: PLATFORM, formId: { in: [FORM_CONSENT, FORM_PLAIN] } } });
    await prisma.adConnection.deleteMany({ where: { studioId: PLATFORM, label: { startsWith: 'M4c e2e' } } });
    await prisma.publicApiIdempotencyKey.deleteMany({ where: { key: { startsWith: 'm4c-e2e' } } });
    await prisma.marketingSettings.deleteMany({ where: { studioId: ZEN } });
    await prisma.webhookDelivery.deleteMany({ where: { endpointId: { in: endpointIds } } });
    await prisma.webhookEndpoint.deleteMany({ where: { id: { in: endpointIds } } });
    await prisma.apiKey.deleteMany({ where: { id: { in: apiKeyIds } } });
    await prisma.approvalRequest.deleteMany({ where: { studioId: PLATFORM, targetId: { in: campaignIds } } });
    await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.segment.deleteMany({ where: { id: { in: segmentIds } } });
    await prisma.auditLog.deleteMany({
      where: {
        createdAt: { gte: startedAt },
        OR: [
          { action: { startsWith: 'public_api.contact.' } },
          { action: { startsWith: 'lead_ads.' } },
          { action: { startsWith: 'integration.lead_ads.' } },
          { action: { startsWith: 'integration.sms_sender.' } },
          { action: { startsWith: 'integration.api_key.' }, studioId: PLATFORM },
          { action: { startsWith: 'marketing.approval.' }, studioId: PLATFORM },
        ],
      },
    });
    const studios = await prisma.studio.findMany({ where: { slug: { startsWith: SLUG } }, select: { id: true } });
    const studioIds = studios.map((s) => s.id);
    if (PLATFORM) {
      await prisma.conversionEvent.deleteMany({ where: { studioId: PLATFORM, sourceId: { in: studioIds } } });
      const owners = await prisma.contact.findMany({ where: { studioId: PLATFORM, phone: { startsWith: TENANT_PHONE_PREFIX } }, select: { id: true } });
      await prisma.contact.deleteMany({ where: { id: { in: owners.map((c) => c.id) } } });
    }
    for (const id of studioIds) {
      await prisma.inviteToken.deleteMany({ where: { studioId: id } });
      await prisma.platformCreditLedger.deleteMany({ where: { studioId: id } });
      await prisma.platformBillingPayment.deleteMany({ where: { studioId: id } });
      await prisma.studio.delete({ where: { id } });
    }
    await prisma.plan.deleteMany({ where: { key: PLAN_KEY } });
    const users = await prisma.user.findMany({ where: { OR: [{ phone: { in: createdUserPhones } }, { phone: { startsWith: TENANT_PHONE_PREFIX } }] }, select: { id: true } });
    const uids = users.map((u) => u.id);
    await prisma.notificationLog.deleteMany({ where: { userId: { in: uids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: uids } } });
    await prisma.membership.deleteMany({ where: { userId: { in: uids } } });
    await prisma.user.deleteMany({ where: { id: { in: uids } } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IysClientAdapter)
      .useValue(iysMock)
      .overrideProvider(META_GRAPH_CLIENT)
      .useValue(graph)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureBodyParsers(app);
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    messaging = app.get(MessagingService);
    sendSpy = jest.spyOn(messaging, 'send');
    // Webhook deliveries never leave the process: the dispatcher's HTTPS call is replaced.
    deliverSpy = jest.spyOn(app.get(WebhookDispatcherService) as unknown as { deliverOnce: () => Promise<unknown> }, 'deliverOnce').mockResolvedValue({ ok: true, statusCode: 200, error: '' });

    const platform = await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } });
    PLATFORM = platform.id;
    previousPlatformMessaging = platform.messagingSettings;
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    previousSettings = await prisma.platformIntegrationSettings.findUnique({ where: { id: 'platform' } });
    await cleanup();

    const previous = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
    previousMfaPolicy = previous?.require2faForPlatformRoles;
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', require2faForPlatformRoles: false }, update: { require2faForPlatformRoles: false } });
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const marketingRole = await prisma.platformRoleTemplate.findUniqueOrThrow({ where: { key: 'marketing_admin' } });
    const marketing = await prisma.user.create({ data: { phone: marketingPhone, firstName: 'Pazarlama', lastName: MARKER, passwordHash, phoneVerifiedAt: new Date() } });
    await prisma.platformMembership.create({ data: { userId: marketing.id, roleTemplateId: marketingRole.id, status: 'ACTIVE', activatedAt: new Date() } });

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    marketingToken = await login(marketingPhone);
    zenOwnerToken = await login(ZEN_OWNER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
  });

  afterAll(async () => {
    sendSpy?.mockRestore();
    deliverSpy?.mockRestore();
    await cleanup();
    await prisma.studio.update({ where: { id: PLATFORM }, data: { messagingSettings: (previousPlatformMessaging ?? {}) as Prisma.InputJsonValue } });
    if (previousSettings) await prisma.platformIntegrationSettings.update({ where: { id: 'platform' }, data: previousSettings });
    else await prisma.platformIntegrationSettings.deleteMany({ where: { id: 'platform' } });
    if (previousMfaPolicy !== undefined) await prisma.platformAccessSettings.update({ where: { id: 'platform' }, data: { require2faForPlatformRoles: previousMfaPolicy } });
    await prisma.platformMembership.deleteMany({ where: { user: { phone: { in: createdUserPhones } } } });
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Verify token and handshake
  // ---------------------------------------------------------------------------

  describe('verify token and the subscription handshake', () => {
    it('only the super admin sets the token; other platform members and tenant owners are refused', async () => {
      expect((await as(marketingToken).put('/admin/integrations/lead-ads/verify-token').send({})).status).toBe(403);
      expect((await as(zenOwnerToken).put('/admin/integrations/lead-ads/verify-token').send({})).status).toBe(403);
      expect((await as(marketingToken).get('/admin/integrations/lead-ads/verify-token')).status).toBe(403);
      expect((await request(server).put('/admin/integrations/lead-ads/verify-token').send({})).status).toBe(401);
      expect((await as(superAdminToken).put('/admin/integrations/lead-ads/verify-token').send({ token: 'short' })).status).toBe(400);
    });

    it('stores only a hash, returns the plaintext once and audit logs the change', async () => {
      const res = await as(superAdminToken).put('/admin/integrations/lead-ads/verify-token').send({ token: VERIFY_TOKEN });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ configured: true, last4: VERIFY_TOKEN.slice(-4), token: VERIFY_TOKEN });
      const row = await prisma.platformIntegrationSettings.findUniqueOrThrow({ where: { id: 'platform' } });
      expect(row.leadgenVerifyTokenHash).toBe(createHash('sha256').update(VERIFY_TOKEN).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(VERIFY_TOKEN);
      const state = await as(superAdminToken).get('/admin/integrations/lead-ads/verify-token');
      expect(state.body).toEqual({ configured: true, last4: VERIFY_TOKEN.slice(-4), setAt: expect.any(String) });
      expect(JSON.stringify(state.body)).not.toContain(VERIFY_TOKEN);
      expect(await prisma.auditLog.count({ where: { action: 'integration.lead_ads.verify_token_set', createdAt: { gte: startedAt } } })).toBe(1);
    });

    it('answers Meta\'s handshake with the challenge only for the right token', async () => {
      const q = (over: Record<string, string>) => request(server).get('/webhooks/meta/leadgen').query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '424242', ...over });
      const ok = await q({});
      expect(ok.status).toBe(200);
      expect(ok.text).toBe('424242');
      expect(ok.headers['content-type']).toContain('text/plain');
      expect((await q({ 'hub.verify_token': 'wrong-token-wrong-token' })).status).toBe(403);
      expect((await q({ 'hub.mode': 'unsubscribe' })).status).toBe(403);
      expect((await q({ 'hub.challenge': '<script>alert(1)</script>' })).status).toBe(403);
      expect((await request(server).get('/webhooks/meta/leadgen').query({ 'hub.mode': 'subscribe', 'hub.challenge': '1' })).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Connection and form mapping through the hub
  // ---------------------------------------------------------------------------

  describe('hub: connection, form mappings and secrets', () => {
    it('configures the page and the app secret and never returns a secret', async () => {
      const created = await tenant(superAdminToken, PLATFORM)
        .post(`/studios/${PLATFORM}/ads/connections`)
        .send({ platform: 'META', label: `M4c e2e ${runId}`, externalAccountId: 'act_74', credentials: { accessToken: 'EAAB-m4c-e2e-token-0000', pixelId: '740000000000001' } });
      expect(created.status).toBe(201);
      connectionId = created.body.id as string;

      // Before configuration the block says so.
      const before = (await hub()).leadAds.connections.find((c) => c.connectionId === connectionId);
      expect(before).toMatchObject({ status: 'NOT_CONFIGURED', pageId: null, appSecretConfigured: false });

      expect((await as(zenOwnerToken).put(`/platform/integrations/lead-ads/${connectionId}`).send({ pageId: PAGE })).status).toBe(403);
      expect((await as(superAdminToken).put(`/platform/integrations/lead-ads/${connectionId}`).send({})).status).toBe(400);
      expect((await as(superAdminToken).put(`/platform/integrations/lead-ads/${connectionId}`).send({ appSecret: 'short' })).status).toBe(400);
      const configured = await as(marketingToken).put(`/platform/integrations/lead-ads/${connectionId}`).send({ pageId: PAGE, appSecret: APP_SECRET });
      expect(configured.status).toBe(200);
      expect(configured.body).toMatchObject({ connectionId, pageId: PAGE, appSecretConfigured: true, status: 'CONFIGURED' });

      const summary = await as(marketingToken).get('/platform/integrations');
      const text = JSON.stringify(summary.body);
      expect(text).not.toContain(APP_SECRET);
      expect(text).not.toContain('EAAB-m4c-e2e-token-0000');
      const listing = await tenant(superAdminToken, PLATFORM).get(`/studios/${PLATFORM}/ads/connections`);
      expect(JSON.stringify(listing.body)).not.toContain(APP_SECRET);
      // The secret lives encrypted with the credentials, not in a plain column.
      const row = await prisma.adConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(row.encryptedCredentials).not.toContain(APP_SECRET);
      expect(row.leadAdsPageId).toBe(PAGE);
      // Only the super admin sees the verify token state.
      expect((await hub(marketingToken)).leadAds.verifyToken).toBeNull();
      expect((await hub()).leadAds.verifyToken).toMatchObject({ configured: true });
    });

    it('keeps the app secret when the token is replaced on the ads screen, and one page feeds one connection', async () => {
      const upd = await tenant(superAdminToken, PLATFORM)
        .patch(`/studios/${PLATFORM}/ads/connections/${connectionId}`)
        .send({ credentials: { accessToken: 'EAAB-m4c-e2e-token-1111', pixelId: '740000000000001' } });
      expect(upd.status).toBe(200);
      const stillConfigured = (await hub()).leadAds.connections.find((c) => c.connectionId === connectionId);
      expect(stillConfigured?.appSecretConfigured).toBe(true);

      const other = await tenant(superAdminToken, PLATFORM)
        .post(`/studios/${PLATFORM}/ads/connections`)
        .send({ platform: 'META', label: `M4c e2e other ${runId}`, externalAccountId: 'act_75', credentials: { accessToken: 'EAAB-m4c-e2e-token-2222', pixelId: '740000000000002' } });
      expect(other.status).toBe(201);
      const clash = await as(superAdminToken).put(`/platform/integrations/lead-ads/${other.body.id}`).send({ pageId: PAGE });
      expect(clash.status).toBe(409);
    });

    it('saves form mappings as data, validates them and audit logs each change', async () => {
      const bad = await as(superAdminToken).put(`/platform/integrations/lead-ads/forms/${FORM_CONSENT}`).send({ mapping: { q1: 'salary' } });
      expect(bad.status).toBe(400);
      expect((await as(superAdminToken).put('/platform/integrations/lead-ads/forms/not-a-form-id').send({ mapping: {} })).status).toBe(400);
      expect((await as(zenOwnerToken).put(`/platform/integrations/lead-ads/forms/${FORM_CONSENT}`).send({ mapping: {} })).status).toBe(403);

      const saved = await as(marketingToken)
        .put(`/platform/integrations/lead-ads/forms/${FORM_CONSENT}`)
        .send({ formName: 'Demo form', mapping: { your_mail: 'email', your_name: 'full_name' }, consentQuestionKey: 'marketing_ok' });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ formId: FORM_CONSENT, mapping: { your_mail: 'email', your_name: 'full_name' }, consentQuestionKey: 'marketing_ok' });
      const plain = await as(superAdminToken).put(`/platform/integrations/lead-ads/forms/${FORM_PLAIN}`).send({ mapping: {} });
      expect(plain.status).toBe(200);
      expect(plain.body.consentQuestionKey).toBeNull();
      expect((await hub()).leadAds.forms.map((f) => f.formId)).toEqual(expect.arrayContaining([FORM_CONSENT, FORM_PLAIN]));
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'integration.lead_ads.form_upsert', createdAt: { gte: startedAt } } })).toBeGreaterThanOrEqual(2);
    });

    it('checks the page subscription through the Graph client and remembers the answer', async () => {
      graph.setSubscribed(PAGE, false);
      const none = await as(superAdminToken).post(`/platform/integrations/lead-ads/${connectionId}/check-subscription`).send({});
      expect(none.status).toBe(200);
      expect(none.body.subscribed).toBe(false);
      graph.setSubscribed(PAGE, true);
      const ok = await as(superAdminToken).post(`/platform/integrations/lead-ads/${connectionId}/check-subscription`).send({});
      expect(ok.body.subscribed).toBe(true);
      expect((await hub()).leadAds.connections.find((c) => c.connectionId === connectionId)?.subscribedAt).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // The signed leadgen webhook
  // ---------------------------------------------------------------------------

  describe('signed leadgen notifications', () => {
    const dePhone = `+49151${runId}1`;
    const deEmail = `de${runId}@${EMAIL_DOMAIN}`;
    let deLeadgen: string;
    let deContactId: string;

    it('creates one contact, a lead conversion, a touchpoint and a pending EU consent, then ignores a duplicate', async () => {
      deLeadgen = newLeadgenId();
      graph.addLead(
        lead(deLeadgen, FORM_CONSENT, {
          your_name: ['Ada Lovelace'],
          your_mail: [deEmail.toUpperCase()],
          phone_number: [dePhone],
          company_name: ['Analytical Engines'],
          country: ['DE'],
          team_size: ['10-20'],
          marketing_ok: ['Yes'],
        }),
      );
      const res = await postLeadgen(notification(deLeadgen, FORM_CONSENT));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });

      const ev = await event(deLeadgen);
      expect(ev).toMatchObject({ status: 'PROCESSED', formId: FORM_CONSENT, pageId: PAGE, attempts: 1 });
      expect(ev.processedAt).not.toBeNull();
      expect(ev.adIds).toEqual({ campaignId: '555', adsetId: '444', adId: '333' });
      expect(ev.attributes).toEqual({ team_size: '10-20', company: 'Analytical Engines' });
      deContactId = ev.contactId!;

      const contact = await prisma.contact.findUniqueOrThrow({ where: { id: deContactId } });
      expect(contact).toMatchObject({
        studioId: PLATFORM,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: deEmail,
        phone: dePhone,
        sourceChannel: 'META_LEAD_AD',
        sourceDetail: FORM_CONSENT,
        lifecycleStage: 'LEAD',
        countryCode: 'DE',
        firstSource: 'meta',
        firstMedium: 'lead_ads',
        firstCampaignId: '555',
        firstAdsetId: '444',
        firstAdId: '333',
      });
      expect(contact.pipelineStageId).not.toBeNull();

      const conversions = await prisma.conversionEvent.findMany({ where: { contactId: deContactId } });
      expect(conversions).toHaveLength(1);
      expect(conversions[0]).toMatchObject({ type: 'lead', studioId: PLATFORM, sourceKind: 'meta_lead_ad', sourceId: deLeadgen });
      expect(conversions[0].attributedTouchpointId).not.toBeNull();
      const touchpoints = await prisma.touchpoint.findMany({ where: { contactId: deContactId } });
      expect(touchpoints).toHaveLength(1);
      expect(touchpoints[0]).toMatchObject({ adPlatform: 'META', pwCid: '555', pwAsid: '444', pwAdid: '333', utmSource: 'meta', utmMedium: 'lead_ads', landingPath: `/lead-ads/${FORM_CONSENT}` });

      // The consent question was ticked: marketing consent on e-mail and SMS, form version = form id,
      // and in Germany (EU) it waits for the double opt-in link.
      const consents = await prisma.contactConsent.findMany({ where: { contactId: deContactId }, orderBy: { channel: 'asc' } });
      expect(consents.map((c) => c.channel).sort()).toEqual(['EMAIL', 'SMS']);
      for (const c of consents) {
        expect(c).toMatchObject({ status: 'GRANTED', legalBasis: 'CONSENT', formVersion: FORM_CONSENT, confirmedAt: null, source: 'web-form' });
        expect(c.confirmationRequestedAt).not.toBeNull();
      }
      const links = confirmLinks().filter((l) => l.contactId === deContactId);
      expect(links).toHaveLength(1);

      const activity = await prisma.contactActivity.findMany({ where: { contactId: deContactId, type: 'FORM' } });
      expect(activity).toHaveLength(1);
      expect(activity[0].metadata).toMatchObject({ leadgenId: deLeadgen, formId: FORM_CONSENT, consent: 'given', attributes: { team_size: '10-20', company: 'Analytical Engines' } });
      expect(await prisma.auditLog.count({ where: { action: 'lead_ads.lead_received', entityId: ev.id } })).toBe(1);
    });

    it('a duplicate delivery of the same lead creates nothing more', async () => {
      const fetchesBefore = graph.fetchCalls.length;
      const again = await postLeadgen(notification(deLeadgen, FORM_CONSENT));
      expect(again.status).toBe(200);
      expect(await prisma.leadAdEvent.count({ where: { studioId: PLATFORM, leadgenId: deLeadgen } })).toBe(1);
      expect(await prisma.contact.count({ where: { studioId: PLATFORM, email: deEmail } })).toBe(1);
      expect(await prisma.conversionEvent.count({ where: { contactId: deContactId, type: 'lead' } })).toBe(1);
      expect(await prisma.touchpoint.count({ where: { contactId: deContactId } })).toBe(1);
      expect(await prisma.contactConsent.count({ where: { contactId: deContactId } })).toBe(2);
      expect(graph.fetchCalls.length).toBe(fetchesBefore);
      expect(confirmLinks().filter((l) => l.contactId === deContactId)).toHaveLength(1);
    });

    it('the confirmation link turns the pending EU consent into a confirmed one', async () => {
      const token = confirmLinks().filter((l) => l.contactId === deContactId).at(-1)!.link.split('/onay/')[1];
      const confirmed = await request(server).post(`/public/consent/confirm/${token}`).send({});
      expect(confirmed.status).toBe(200);
      expect(confirmed.body).toEqual({ result: 'CONFIRMED' });
      const consents = await prisma.contactConsent.findMany({ where: { contactId: deContactId } });
      expect(consents.every((c) => c.confirmedAt !== null)).toBe(true);
    });

    it('a form with no consent question records no commercial consent, whatever else it says', async () => {
      const id = newLeadgenId();
      const email = `plain${runId}@${EMAIL_DOMAIN}`;
      graph.addLead(lead(id, FORM_PLAIN, { email: [email], phone_number: [`+49151${runId}2`], country: ['DE'], marketing_ok: ['yes'] }));
      expect((await postLeadgen(notification(id, FORM_PLAIN))).status).toBe(200);
      const ev = await event(id);
      expect(ev.status).toBe('PROCESSED');
      expect(await prisma.contactConsent.count({ where: { contactId: ev.contactId! } })).toBe(0);
      expect(confirmLinks().filter((l) => l.contactId === ev.contactId)).toHaveLength(0);
      // The unmapped answer stays in the attributes bag.
      expect(ev.attributes).toEqual({ marketing_ok: 'yes' });
      const contact = await prisma.contact.findUniqueOrThrow({ where: { id: ev.contactId! } });
      expect(contact).toMatchObject({ firstName: `plain${runId}`, email });
    });

    it('an unticked consent box records no consent; outside the double opt-in regions a ticked one counts at once', async () => {
      const unticked = newLeadgenId();
      graph.addLead(lead(unticked, FORM_CONSENT, { your_mail: [`unticked${runId}@${EMAIL_DOMAIN}`], marketing_ok: [] }));
      expect((await postLeadgen(notification(unticked, FORM_CONSENT))).status).toBe(200);
      expect(await prisma.contactConsent.count({ where: { contactId: (await event(unticked)).contactId! } })).toBe(0);

      const us = newLeadgenId();
      graph.addLead(lead(us, FORM_CONSENT, { your_mail: [`us${runId}@${EMAIL_DOMAIN}`], country: ['US'], marketing_ok: ['yes'] }));
      expect((await postLeadgen(notification(us, FORM_CONSENT))).status).toBe(200);
      const usContact = (await event(us)).contactId!;
      const rows = await prisma.contactConsent.findMany({ where: { contactId: usContact } });
      expect(rows.map((r) => r.channel)).toEqual(['EMAIL']);
      expect(rows[0]).toMatchObject({ status: 'GRANTED', confirmationRequestedAt: null, formVersion: FORM_CONSENT });
    });

    it('a returning person is matched by e-mail: one contact, a second lead conversion', async () => {
      const id = newLeadgenId();
      graph.addLead(lead(id, FORM_PLAIN, { email: [deEmail], your_name: ['Someone Else'] }));
      expect((await postLeadgen(notification(id, FORM_PLAIN))).status).toBe(200);
      expect((await event(id)).contactId).toBe(deContactId);
      expect(await prisma.contact.count({ where: { studioId: PLATFORM, email: deEmail } })).toBe(1);
      expect(await prisma.conversionEvent.count({ where: { contactId: deContactId, type: 'lead' } })).toBe(2);
    });

    it('rejects a bad, missing or foreign signature with 401 and stores nothing', async () => {
      const id = newLeadgenId();
      graph.addLead(lead(id, FORM_PLAIN, { email: [`bad${runId}@${EMAIL_DOMAIN}`] }));
      const fetches = graph.fetchCalls.length;
      expect((await postLeadgen(notification(id, FORM_PLAIN), 'a-completely-different-secret-1234')).status).toBe(401);
      expect((await postLeadgen(notification(id, FORM_PLAIN), null)).status).toBe(401);
      expect((await postLeadgen(notification(id, FORM_PLAIN), APP_SECRET, `sha256=${'0'.repeat(64)}`)).status).toBe(401);
      expect((await postLeadgen(notification(id, FORM_PLAIN), APP_SECRET, 'sha1=abc')).status).toBe(401);
      // A correct signature over a body for a page nobody connected is refused too.
      expect((await postLeadgen(notification(id, FORM_PLAIN, '999000111'))).status).toBe(401);
      expect(await prisma.leadAdEvent.count({ where: { studioId: PLATFORM, leadgenId: id } })).toBe(0);
      expect(graph.fetchCalls.length).toBe(fetches);
      expect(await prisma.contact.count({ where: { email: `bad${runId}@${EMAIL_DOMAIN}` } })).toBe(0);
    });

    it('retries a transient Graph failure on the heartbeat and keeps a permanent failure for a manual retry', async () => {
      const flaky = newLeadgenId();
      graph.addLead(lead(flaky, FORM_PLAIN, { email: [`flaky${runId}@${EMAIL_DOMAIN}`] }));
      graph.failLead(flaky, 1, true);
      expect((await postLeadgen(notification(flaky, FORM_PLAIN))).status).toBe(200);
      const first = await event(flaky);
      expect(first).toMatchObject({ status: 'RETRY', attempts: 1, contactId: null });
      expect(first.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await prisma.contact.count({ where: { email: `flaky${runId}@${EMAIL_DOMAIN}` } })).toBe(0);

      // Not due yet: nothing happens. Later: the retry succeeds.
      expect((await runScheduler(new Date(Date.now() + 5 * 1000))).status).toBe(201);
      expect((await event(flaky)).status).toBe('RETRY');
      const later = await runScheduler(new Date(Date.now() + 10 * MINUTE));
      expect(later.status).toBe(201);
      expect(later.body.leadAds.processed).toBeGreaterThanOrEqual(1);
      const done = await event(flaky);
      expect(done).toMatchObject({ status: 'PROCESSED', attempts: 2 });
      expect(done.contactId).not.toBeNull();

      const denied = newLeadgenId();
      graph.addLead(lead(denied, FORM_PLAIN, { email: [`denied${runId}@${EMAIL_DOMAIN}`] }));
      graph.failLead(denied, 1, false, 403);
      expect((await postLeadgen(notification(denied, FORM_PLAIN))).status).toBe(200);
      expect(await event(denied)).toMatchObject({ status: 'FAILED', attempts: 1, contactId: null });
      const blocks = (await hub()).leadAds;
      expect(blocks.failedCount).toBeGreaterThanOrEqual(1);
      expect(blocks.connections.find((c) => c.connectionId === connectionId)).toMatchObject({ status: 'ERROR' });

      const events = await as(superAdminToken).get('/platform/integrations/lead-ads/events');
      expect(events.status).toBe(200);
      const failedRow = (events.body as { id: string; leadgenId: string; status: string }[]).find((e) => e.leadgenId === denied)!;
      expect(failedRow.status).toBe('FAILED');
      expect((await as(zenOwnerToken).post(`/platform/integrations/lead-ads/events/${failedRow.id}/retry`).send({})).status).toBe(403);
      expect((await as(superAdminToken).post(`/platform/integrations/lead-ads/events/${failedRow.id}/retry`).send({})).status).toBe(200);
      expect((await event(denied)).status).toBe('PENDING');
      expect((await runScheduler(new Date(Date.now() + MINUTE))).status).toBe(201);
      expect((await event(denied)).status).toBe('PROCESSED');
      // Only a failed event can be retried.
      expect((await as(superAdminToken).post(`/platform/integrations/lead-ads/events/${failedRow.id}/retry`).send({})).status).toBe(404);
    });

    it('a lead with neither phone nor e-mail fails for good and creates no contact', async () => {
      const id = newLeadgenId();
      graph.addLead(lead(id, FORM_PLAIN, { your_name: ['No Contact'] }));
      expect((await postLeadgen(notification(id, FORM_PLAIN))).status).toBe(200);
      expect(await event(id)).toMatchObject({ status: 'FAILED', contactId: null });
    });

    it('the hub shows the block once leads arrived', async () => {
      const block = (await hub()).leadAds;
      expect(block.lastLeadAt).not.toBeNull();
      expect(block.webhookPath).toBe('webhooks/meta/leadgen');
      expect(block.connections.find((c) => c.connectionId === connectionId)).toMatchObject({ pageId: PAGE, appSecretConfigured: true });
      expect(block.forms.find((f) => f.formId === FORM_CONSENT)).toMatchObject({ consentQuestionKey: 'marketing_ok' });
    });
  });

  // ---------------------------------------------------------------------------
  // SMS sender identity block
  // ---------------------------------------------------------------------------

  describe('SMS sender identity', () => {
    it('stores registration status per provider and the Twilio 10DLC status as data, audit logged', async () => {
      const before = (await hub()).smsSender;
      expect(before.providers.map((p) => p.provider)).toEqual(['NETGSM', 'ILETI_MERKEZI', 'TWILIO']);
      expect(before.providers.every((p) => p.status === 'NOT_STARTED' || p.status === 'APPROVED' || p.status === 'PENDING' || p.status === 'REJECTED')).toBe(true);

      const sender = await as(marketingToken).put('/platform/integrations/sms-sender').send({ kind: 'SENDER_ID', provider: 'NETGSM', senderId: 'ACMEFIT', status: 'PENDING' });
      expect(sender.status).toBe(200);
      expect(sender.body.providers.find((p: { provider: string }) => p.provider === 'NETGSM')).toMatchObject({ senderId: 'ACMEFIT', status: 'PENDING' });
      const dlc = await as(superAdminToken).put('/platform/integrations/sms-sender').send({ kind: 'TWILIO_10DLC', brandStatus: 'APPROVED', campaignStatus: 'PENDING' });
      expect(dlc.status).toBe(200);
      expect(dlc.body.twilio10dlc).toMatchObject({ brandStatus: 'APPROVED', campaignStatus: 'PENDING' });

      const after = (await hub()).smsSender;
      expect(after.providers.find((p) => p.provider === 'NETGSM')).toMatchObject({ senderId: 'ACMEFIT', status: 'PENDING' });
      expect(after.twilio10dlc).toMatchObject({ brandStatus: 'APPROVED', campaignStatus: 'PENDING' });
      // Stored in the platform tenant's messaging settings; the earlier keys survive.
      const studio = await prisma.studio.findUniqueOrThrow({ where: { id: PLATFORM } });
      expect(studio.messagingSettings).toMatchObject({ smsSenderRegistrations: { NETGSM: { senderId: 'ACMEFIT', status: 'PENDING' } }, twilio10dlc: { brandStatus: 'APPROVED' } });
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: { startsWith: 'integration.sms_sender.' }, createdAt: { gte: startedAt } } })).toBe(2);
    });

    it('refuses bad input and non-platform callers', async () => {
      expect((await as(superAdminToken).put('/platform/integrations/sms-sender').send({ kind: 'SENDER_ID', provider: 'NETGSM', senderId: '1bad', status: 'PENDING' })).status).toBe(400);
      expect((await as(superAdminToken).put('/platform/integrations/sms-sender').send({ kind: 'SENDER_ID', provider: 'NOPE', senderId: 'ACME', status: 'PENDING' })).status).toBe(400);
      expect((await as(zenOwnerToken).put('/platform/integrations/sms-sender').send({ kind: 'TWILIO_10DLC', brandStatus: 'APPROVED', campaignStatus: 'APPROVED' })).status).toBe(403);
    });

    it('a tenant cannot write the registration through its own messaging settings', async () => {
      const res = await request(server)
        .put(`/studios/${ZEN}/messaging/settings`)
        .set('Authorization', `Bearer ${zenOwnerToken}`)
        .set('x-studio-id', ZEN)
        .send({ smsSenderRegistrations: { NETGSM: { senderId: 'HACK', status: 'APPROVED' } } });
      expect(res.status).toBe(400);
      const twilio = await request(server)
        .put(`/studios/${ZEN}/messaging/settings`)
        .set('Authorization', `Bearer ${zenOwnerToken}`)
        .set('x-studio-id', ZEN)
        .send({ twilio10dlc: { brandStatus: 'APPROVED', campaignStatus: 'APPROVED' } });
      expect(twilio.status).toBe(400);
      const zen = await prisma.studio.findUniqueOrThrow({ where: { id: ZEN } });
      expect(JSON.stringify(zen.messagingSettings)).not.toContain('HACK');
    });
  });

  // ---------------------------------------------------------------------------
  // Public write API
  // ---------------------------------------------------------------------------

  describe('public API: contacts, tags and consents (crm.write)', () => {
    let crmKey: string;
    let readKey: string;
    let flowCrmKey: string;
    const email = `api${runId}@${EMAIL_DOMAIN}`;
    const phone = `+49152${runId}1`;
    let contactId: string;

    const makeKey = async (token: string, studioId: string, name: string, scopes: string[]) => {
      const res = await tenant(token, studioId).post('/integrations/api-keys').send({ name, scopes });
      expect(res.status).toBe(201);
      apiKeyIds.push(res.body.id as string);
      return res.body.plaintext as string;
    };

    beforeAll(async () => {
      crmKey = await makeKey(zenOwnerToken, ZEN, 'M4c e2e crm', ['crm.write']);
      readKey = await makeKey(zenOwnerToken, ZEN, 'M4c e2e read', ['schedules.read']);
      flowCrmKey = await makeKey(flowOwnerToken, FLOW, 'M4c e2e flow crm', ['crm.write']);
    });

    it('needs an API key with the crm.write scope', async () => {
      expect((await request(server).post('/v1/public/contacts').send({ email })).status).toBe(401);
      expect((await withKey(readKey).post('/v1/public/contacts').send({ email })).status).toBe(403);
      expect((await withKey('pk_live_nope').post('/v1/public/contacts').send({ email })).status).toBe(401);
      // The scope exists in the catalogue and the connection test lists it.
      const me = await withKey(crmKey).get('/v1/public/me');
      expect(me.body.scopes).toEqual(['crm.write']);
    });

    it('creates a contact (201), masks the phone, and updates the same person on a second call (200)', async () => {
      const created = await withKey(crmKey).post('/v1/public/contacts').send({ email: email.toUpperCase(), phone, fullName: 'Grace Hopper', tags: ['  VIP ', 'zapier'], locale: 'en', countryCode: 'DE' });
      expect(created.status).toBe(201);
      expect(created.body.created).toBe(true);
      expect(created.body.contact).toMatchObject({ firstName: 'Grace', lastName: 'Hopper', email, tags: ['vip', 'zapier'], lifecycleStage: 'LEAD' });
      expect(created.body.contact.phone).toBe(`+49 *** *** ** ${phone.slice(-2)}`);
      expect(JSON.stringify(created.body)).not.toContain(phone);
      contactId = created.body.contact.id as string;
      const row = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
      expect(row).toMatchObject({ studioId: ZEN, phone, sourceChannel: 'API', countryCode: 'DE', locale: 'en' });

      const again = await withKey(crmKey).post('/v1/public/contacts').send({ email, firstName: 'Grace B.', lastName: 'Hopper', tags: ['newtag'], isBusiness: true });
      expect(again.status).toBe(200);
      expect(again.body.created).toBe(false);
      expect(again.body.contact).toMatchObject({ id: contactId, firstName: 'Grace B.', tags: ['vip', 'zapier', 'newtag'] });
      expect(await prisma.contact.count({ where: { studioId: ZEN, email } })).toBe(1);
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).isBusiness).toBe(true);

      // A phone alone matches too.
      const byPhone = await withKey(crmKey).post('/v1/public/contacts').send({ phone, lastName: 'Hopper' });
      expect(byPhone.status).toBe(200);
      expect(byPhone.body.contact.id).toBe(contactId);
      expect(await prisma.auditLog.count({ where: { studioId: ZEN, action: 'public_api.contact.upsert', entityId: contactId } })).toBe(3);
    });

    it('validates the body: an e-mail or phone is required, unknown fields, bad phones and unknown custom fields are refused', async () => {
      expect((await withKey(crmKey).post('/v1/public/contacts').send({ firstName: 'No Way' })).status).toBe(400);
      expect((await withKey(crmKey).post('/v1/public/contacts').send({ email, studioId: FLOW })).status).toBe(400);
      expect((await withKey(crmKey).post('/v1/public/contacts').send({ phone: '12' })).status).toBe(400);
      expect((await withKey(crmKey).post('/v1/public/contacts').send({ email: `x${runId}@${EMAIL_DOMAIN}`, customFields: { no_such_field: 'x' } })).status).toBe(400);
      expect(await prisma.contact.count({ where: { studioId: ZEN, email: `x${runId}@${EMAIL_DOMAIN}` } })).toBe(0);
    });

    it('Idempotency-Key: the same key replays the stored response, another body is refused, a malformed key is a 400', async () => {
      const key = `m4c-e2e-idem-${runId}`;
      const body = { email: `idem${runId}@${EMAIL_DOMAIN}`, fullName: 'Idem Potent', tags: ['idem'] };
      const first = await withKey(crmKey).post('/v1/public/contacts').set('Idempotency-Key', key).send(body);
      expect(first.status).toBe(201);
      expect(first.headers['idempotent-replayed']).toBeUndefined();

      const replay = await withKey(crmKey).post('/v1/public/contacts').set('Idempotency-Key', key).send({ tags: ['idem'], fullName: 'Idem Potent', email: body.email });
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await prisma.contact.count({ where: { studioId: ZEN, email: body.email } })).toBe(1);
      expect(await prisma.publicApiIdempotencyKey.count({ where: { studioId: ZEN, key } })).toBe(1);

      const clash = await withKey(crmKey).post('/v1/public/contacts').set('Idempotency-Key', key).send({ ...body, fullName: 'Someone Else' });
      expect(clash.status).toBe(422);
      expect(clash.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect((await withKey(crmKey).post('/v1/public/contacts').set('Idempotency-Key', 'short').send(body)).status).toBe(400);

      // Without the header the same body is simply an update.
      expect((await withKey(crmKey).post('/v1/public/contacts').send(body)).status).toBe(200);

      // After its 24 hours the record is gone and the key is free again.
      await prisma.publicApiIdempotencyKey.updateMany({ where: { studioId: ZEN, key }, data: { expiresAt: new Date(Date.now() - MINUTE) } });
      const fresh = await withKey(crmKey).post('/v1/public/contacts').set('Idempotency-Key', key).send({ ...body, fullName: 'Someone Else' });
      expect(fresh.status).toBe(200);
      expect(fresh.headers['idempotent-replayed']).toBeUndefined();

      // The key is scoped to the studio: another studio's key of the same name is independent.
      const flowFirst = await withKey(flowCrmKey).post('/v1/public/contacts').set('Idempotency-Key', key).send({ email: `flowidem${runId}@${EMAIL_DOMAIN}` });
      expect(flowFirst.status).toBe(201);
      await prisma.contact.deleteMany({ where: { studioId: FLOW, email: `flowidem${runId}@${EMAIL_DOMAIN}` } });
    });

    it('adds tags, normalises them and keeps every query inside the key\'s studio', async () => {
      const res = await withKey(crmKey).post(`/v1/public/contacts/${contactId}/tags`).send({ tags: ['Customer ', 'vip'] });
      expect(res.status).toBe(200);
      expect(res.body.tags).toEqual(['vip', 'zapier', 'newtag', 'customer']);
      expect((await withKey(crmKey).post(`/v1/public/contacts/${contactId}/tags`).send({ tags: [] })).status).toBe(400);
      expect((await withKey(crmKey).post(`/v1/public/contacts/${contactId}/tags`).send({ tags: ['!!'] })).status).toBe(400);
      expect((await withKey(crmKey).post('/v1/public/contacts/not-a-uuid/tags').send({ tags: ['a'] })).status).toBe(400);
      // Another studio's key cannot touch this contact: it does not exist there.
      const foreign = await withKey(flowCrmKey).post(`/v1/public/contacts/${contactId}/tags`).send({ tags: ['stolen'] });
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('CONTACT_NOT_FOUND');
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).tags).not.toContain('stolen');
      expect((await withKey(readKey).post(`/v1/public/contacts/${contactId}/tags`).send({ tags: ['a'] })).status).toBe(403);
      expect(await prisma.auditLog.count({ where: { studioId: ZEN, action: 'public_api.contact.tags_add', entityId: contactId } })).toBe(1);
    });

    it('records consent with a legal basis and form version; a German contact goes through double opt-in', async () => {
      const noVersion = await withKey(crmKey).post(`/v1/public/contacts/${contactId}/consents`).send({ channels: ['EMAIL'] });
      expect(noVersion.status).toBe(400);

      // A tenant without a consent policy row keeps the behaviour it had before M3e: no double opt-in.
      const noPolicy = await withKey(crmKey).post('/v1/public/contacts').send({ email: `nopolicy${runId}@${EMAIL_DOMAIN}`, fullName: 'No Policy', countryCode: 'DE' });
      const noPolicyResult = await withKey(crmKey).post(`/v1/public/contacts/${noPolicy.body.contact.id}/consents`).send({ channels: ['EMAIL'], formVersion: 'zapier-form-v1' });
      expect(noPolicyResult.status).toBe(200);
      expect(noPolicyResult.body).toMatchObject({ doubleOptIn: false, channels: [expect.objectContaining({ pendingConfirmation: false })] });

      // Once the tenant has a policy (EU and UK need double opt-in by default) the German contact waits for the link.
      await prisma.marketingSettings.upsert({ where: { studioId: ZEN }, create: { studioId: ZEN }, update: {} });
      const sent = confirmLinks().length;
      const granted = await withKey(crmKey).post(`/v1/public/contacts/${contactId}/consents`).send({ channels: ['EMAIL', 'SMS'], formVersion: 'zapier-form-v1' });
      expect(granted.status).toBe(200);
      expect(granted.body).toMatchObject({ contactId, doubleOptIn: true });
      expect(granted.body.channels).toEqual(
        expect.arrayContaining([
          { channel: 'EMAIL', status: 'GRANTED', legalBasis: 'CONSENT', pendingConfirmation: true, suppressed: false },
          { channel: 'SMS', status: 'GRANTED', legalBasis: 'CONSENT', pendingConfirmation: true, suppressed: false },
        ]),
      );
      const rows = await prisma.contactConsent.findMany({ where: { contactId } });
      for (const r of rows) expect(r).toMatchObject({ formVersion: 'zapier-form-v1', confirmedAt: null, source: 'web-form' });
      expect(confirmLinks().length).toBe(sent + 1);
      expect(await prisma.auditLog.count({ where: { studioId: ZEN, action: 'public_api.contact.consent', entityId: contactId } })).toBe(1);

      // The same request again does not send another e-mail or change the rows.
      const repeat = await withKey(crmKey).post(`/v1/public/contacts/${contactId}/consents`).send({ channels: ['EMAIL', 'SMS'], formVersion: 'zapier-form-v1' });
      expect(repeat.status).toBe(200);
      expect(await prisma.contactConsent.count({ where: { contactId } })).toBe(2);
      await prisma.marketingSettings.deleteMany({ where: { studioId: ZEN } });
    });

    it('a contact outside the double opt-in regions counts at once, and a channel without an address is refused', async () => {
      const us = await withKey(crmKey).post('/v1/public/contacts').send({ email: `usapi${runId}@${EMAIL_DOMAIN}`, fullName: 'Us Person', countryCode: 'US' });
      expect(us.status).toBe(201);
      const usId = us.body.contact.id as string;
      const ok = await withKey(crmKey).post(`/v1/public/contacts/${usId}/consents`).send({ channels: ['EMAIL'], formVersion: 'zapier-form-v1' });
      expect(ok.status).toBe(200);
      expect(ok.body.doubleOptIn).toBe(false);
      expect(ok.body.channels).toEqual([{ channel: 'EMAIL', status: 'GRANTED', legalBasis: 'CONSENT', pendingConfirmation: false, suppressed: false }]);
      const noPhone = await withKey(crmKey).post(`/v1/public/contacts/${usId}/consents`).send({ channels: ['SMS'], formVersion: 'zapier-form-v1' });
      expect(noPhone.status).toBe(422);
      expect(noPhone.body.code).toBe('CONSENT_CHANNEL_ADDRESS_MISSING');
    });

    it('revokes consent, and refuses bases that cannot be recorded here', async () => {
      const revoked = await withKey(crmKey).post(`/v1/public/contacts/${contactId}/consents`).send({ channels: ['EMAIL'], granted: false });
      expect(revoked.status).toBe(200);
      expect(revoked.body.channels).toEqual([expect.objectContaining({ channel: 'EMAIL', status: 'REVOKED' })]);

      const existing = await withKey(crmKey).post(`/v1/public/contacts/${contactId}/consents`).send({ channels: ['EMAIL'], legalBasis: 'EXISTING_CUSTOMER' });
      expect(existing.status).toBe(422);
      expect(existing.body.code).toBe('CONSENT_BASIS_NOT_ALLOWED');

      // The TR merchant exemption needs the platform switch, a business contact and a TR person.
      const tr = await withKey(crmKey).post('/v1/public/contacts').send({ email: `trbiz${runId}@${EMAIL_DOMAIN}`, phone: `+90539${runId}`, fullName: 'Tr Business', countryCode: 'TR', isBusiness: true });
      expect(tr.status).toBe(201);
      const trId = tr.body.contact.id as string;
      const off = await withKey(crmKey).post(`/v1/public/contacts/${trId}/consents`).send({ channels: ['EMAIL'], legalBasis: 'TR_MERCHANT_EXEMPTION' });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe('CONSENT_BASIS_NOT_ALLOWED');

      await prisma.marketingSettings.upsert({ where: { studioId: ZEN }, create: { studioId: ZEN, trMerchantExemptionEnabled: true }, update: { trMerchantExemptionEnabled: true } });
      const on = await withKey(crmKey).post(`/v1/public/contacts/${trId}/consents`).send({ channels: ['EMAIL'], legalBasis: 'TR_MERCHANT_EXEMPTION' });
      expect(on.status).toBe(200);
      expect(on.body.channels).toEqual([expect.objectContaining({ channel: 'EMAIL', status: 'GRANTED', legalBasis: 'TR_MERCHANT_EXEMPTION', pendingConfirmation: false })]);
      // A private person in Turkey does not qualify even with the switch on.
      const person = await withKey(crmKey).post('/v1/public/contacts').send({ email: `trperson${runId}@${EMAIL_DOMAIN}`, fullName: 'Tr Person', countryCode: 'TR' });
      const denied = await withKey(crmKey).post(`/v1/public/contacts/${person.body.contact.id}/consents`).send({ channels: ['EMAIL'], legalBasis: 'TR_MERCHANT_EXEMPTION' });
      expect(denied.status).toBe(409);
      await prisma.marketingSettings.deleteMany({ where: { studioId: ZEN } });
    });

    it('another studio\'s key cannot record consent for this contact', async () => {
      const res = await withKey(flowCrmKey).post(`/v1/public/contacts/${contactId}/consents`).send({ channels: ['EMAIL'], formVersion: 'v1' });
      expect(res.status).toBe(404);
    });

    it('is rate limited per key like the other public endpoints', async () => {
      // 120 requests per minute per key: the counter of this key is far below that here, so a burst of
      // reads on the same guard shows the limiter is in the chain (ApiKeyRateLimitGuard) without exhausting it.
      const limitedKey = await makeKey(zenOwnerToken, ZEN, 'M4c e2e limited', ['crm.write']);
      let refused = 0;
      for (let i = 0; i < 125; i += 1) {
        const res = await withKey(limitedKey).post('/v1/public/contacts').send({ firstName: 'x' });
        if (res.status === 429) refused += 1;
        else expect(res.status).toBe(400);
      }
      expect(refused).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Platform events
  // ---------------------------------------------------------------------------

  describe('platform events reach only the platform tenant\'s subscriptions', () => {
    let platformKey: string;
    let zenHookKey: string;
    const secrets = new Map<string, string>();
    const endpointOf = new Map<string, string>();

    const deliveriesOf = (event: string) => prisma.webhookDelivery.findMany({ where: { event, endpoint: { studioId: PLATFORM, id: { in: endpointIds } } }, orderBy: { createdAt: 'asc' } });

    beforeAll(async () => {
      const created = await as(superAdminToken).post('/platform/integrations/api-keys').send({ name: `M4c e2e platform ${runId}`, scopes: ['webhooks.manage', 'crm.write'] });
      expect(created.status).toBe(201);
      apiKeyIds.push(created.body.id as string);
      platformKey = created.body.plaintext as string;
      const zen = await tenant(zenOwnerToken, ZEN).post('/integrations/api-keys').send({ name: 'M4c e2e zen hooks', scopes: ['webhooks.manage'] });
      apiKeyIds.push(zen.body.id as string);
      zenHookKey = zen.body.plaintext as string;
    });

    it('the catalogue has the five platform events with samples and the hub lists them', async () => {
      expect([...PLATFORM_WEBHOOK_EVENTS]).toEqual(['studio.signup', 'studio.paid', 'studio.trial_expiring', 'contact.lifecycle_changed', 'campaign.sent']);
      for (const event of PLATFORM_WEBHOOK_EVENTS) {
        const sample = await withKey(platformKey).get(`/v1/public/hooks/samples/${event}`);
        expect(sample.status).toBe(200);
        expect(sample.body).toMatchObject({ event, studioId: PLATFORM });
      }
      const block = (await hub()).automation;
      expect(block.platformEvents.map((e) => e.event)).toEqual([...PLATFORM_WEBHOOK_EVENTS]);
      expect(block.crmWriteKeyCount).toBeGreaterThanOrEqual(1);
      expect((await hub()).apiKeys.find((k) => k.id === apiKeyIds.at(-2))?.scopes).toEqual(['webhooks.manage', 'crm.write']);
    });

    it('a non-platform tenant cannot subscribe to a platform event, the platform tenant can', async () => {
      for (const event of PLATFORM_WEBHOOK_EVENTS) {
        expect((await withKey(zenHookKey).post('/v1/public/hooks').send({ targetUrl: 'https://example.com/m4c-zen', event })).status).toBe(400);
      }
      expect((await tenant(zenOwnerToken, ZEN).post('/integrations/webhooks').send({ url: 'https://example.com/m4c-zen', events: ['studio.paid'] })).status).toBe(400);
      for (const event of PLATFORM_WEBHOOK_EVENTS) {
        const res = await withKey(platformKey).post('/v1/public/hooks').send({ targetUrl: `https://example.com/m4c-${event}`, event });
        expect(res.status).toBe(201);
        endpointIds.push(res.body.id as string);
        secrets.set(event, res.body.secret as string);
        endpointOf.set(event, res.body.id as string);
      }
      const block = (await hub()).automation;
      for (const e of block.platformEvents) expect(e.activeSubscriptions).toBe(1);
    });

    it('contact.lifecycle_changed fires for a platform contact and never for another tenant\'s contact', async () => {
      const platformContact = (await event(leadgenIds[0])).contactId!;
      const res = await tenant(superAdminToken, PLATFORM).patch(`/crm/studios/${PLATFORM}/contacts/${platformContact}`).send({ lifecycleStage: 'TRIAL' });
      expect(res.status).toBe(200);
      const deliveries = await deliveriesOf('contact.lifecycle_changed');
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].payload).toMatchObject({ event: 'contact.lifecycle_changed', studioId: PLATFORM, data: { contactId: platformContact, from: 'LEAD', to: 'TRIAL' } });

      // The same change on a ZEN contact queues nothing anywhere.
      const zenContact = await prisma.contact.create({ data: { studioId: ZEN, firstName: 'Zen', lastName: MARKER, email: `zenlc${runId}@${EMAIL_DOMAIN}`, lifecycleStage: 'LEAD' } });
      const before = await prisma.webhookDelivery.count({ where: { event: 'contact.lifecycle_changed' } });
      expect((await tenant(zenOwnerToken, ZEN).patch(`/crm/studios/${ZEN}/contacts/${zenContact.id}`).send({ lifecycleStage: 'TRIAL' })).status).toBe(200);
      expect(await prisma.webhookDelivery.count({ where: { event: 'contact.lifecycle_changed' } })).toBe(before);
    });

    it('studio.signup, studio.trial_expiring and studio.paid follow a new business through signup, trial and activation', async () => {
      const admin = () => ({ post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${superAdminToken}`) });
      const plan = await admin().post('/admin/plans').send({ key: PLAN_KEY, name: 'E2E M4c', prices: [{ currency: 'EUR', priceMonthly: 99 }], trialDays: 14, limits: {} });
      expect(plan.status).toBe(201);
      const tenantSlug = `${SLUG}-${runId}`;
      const created = await admin()
        .post('/admin/tenants')
        .send({
          name: `E2E M4c ${tenantSlug}`,
          slug: tenantSlug,
          businessTypeTemplateKey: 'pilates_studio',
          planKey: PLAN_KEY,
          countryCode: 'DE',
          ownerFirstName: 'Deneme',
          ownerLastName: 'Sahibi',
          ownerPhone: `${TENANT_PHONE_PREFIX}${String(randomInt(0, 100_000)).padStart(5, '0')}`,
        });
      expect(created.status).toBe(201);
      const newStudioId = created.body.studioId as string;

      const signups = await deliveriesOf('studio.signup');
      expect(signups).toHaveLength(1);
      expect(signups[0].payload).toMatchObject({ event: 'studio.signup', studioId: PLATFORM, data: { studioId: newStudioId, name: `E2E M4c ${tenantSlug}`, slug: tenantSlug, countryCode: 'DE' } });

      // Trial ending: 2 days left, the reminder heartbeat claims the 3-day threshold and emits once.
      const now = new Date();
      await prisma.studio.update({ where: { id: newStudioId }, data: { billingStatus: 'TRIALING', trialEndsAt: new Date(now.getTime() + 2 * DAY), trialReminderSentDays: null } });
      expect(await app.get(BillingJobsService).sendReminders(now)).toBeGreaterThanOrEqual(0);
      const expiring = await deliveriesOf('studio.trial_expiring');
      expect(expiring).toHaveLength(1);
      expect(expiring[0].payload).toMatchObject({ event: 'studio.trial_expiring', studioId: PLATFORM, data: { studioId: newStudioId, daysLeft: 2 } });
      // The same threshold is never announced twice.
      await app.get(BillingJobsService).sendReminders(new Date(now.getTime() + MINUTE));
      expect(await deliveriesOf('studio.trial_expiring')).toHaveLength(1);

      // Activation with a recorded payment.
      const forced = await admin().post(`/admin/tenants/${newStudioId}/billing-status`).send({ status: 'ACTIVE', planKey: PLAN_KEY, reason: 'e2e', recordAsPaid: true });
      expect(forced.status).toBe(200);
      const paid = await deliveriesOf('studio.paid');
      expect(paid).toHaveLength(1);
      expect(paid[0].payload).toMatchObject({ event: 'studio.paid', studioId: PLATFORM, data: { studioId: newStudioId, planKey: PLAN_KEY, amount: '99.00', currency: 'EUR' } });
    });

    it('campaign.sent fires when a platform campaign completes', async () => {
      const contact = await prisma.contact.create({ data: { studioId: PLATFORM, firstName: 'Camp', lastName: MARKER, phone: `+49153${runId}1`, countryCode: 'DE', lifecycleStage: 'LEAD' } });
      const seg = await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/segments`).send({ name: `M4c e2e ${runId}`, kind: 'STATIC' });
      expect(seg.status).toBe(201);
      segmentIds.push(seg.body.id as string);
      expect((await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/segments/${seg.body.id}/members`).send({ add: [contact.id] })).status).toBe(201);
      const camp = await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/campaigns`).send({ name: `M4c e2e ${runId}`, segmentId: seg.body.id, channel: 'SMS', templateKey: 'WIN_BACK' });
      expect(camp.status).toBe(201);
      campaignIds.push(camp.body.id as string);
      const req = await as(superAdminToken).post(`/platform/marketing/campaigns/${camp.body.id}/request-approval`).send({});
      expect(req.status).toBe(200);
      if (req.body.request.status === 'PENDING') {
        expect((await as(superAdminToken).post(`/platform/marketing/approvals/${req.body.request.id}/approve`).send({})).status).toBe(200);
      }
      expect((await runScheduler(new Date(Date.now() + MINUTE))).status).toBe(201);
      const row = await prisma.campaign.findUniqueOrThrow({ where: { id: camp.body.id as string } });
      expect(row.status).toBe('SENT');
      const sent = await deliveriesOf('campaign.sent');
      expect(sent).toHaveLength(1);
      expect(sent[0].payload).toMatchObject({ event: 'campaign.sent', studioId: PLATFORM, data: { campaignId: camp.body.id, channel: 'SMS', audience: 1 } });
      // Every recipient is accounted for (sent, skipped or failed).
      const data = (sent[0].payload as { data: { sent: number; skipped: number; failed: number } }).data;
      expect(data.sent + data.skipped + data.failed).toBe(1);
    });

    it('a ZEN campaign completing queues no platform event', async () => {
      const before = await prisma.webhookDelivery.count({ where: { event: 'campaign.sent' } });
      const seg = await tenant(zenOwnerToken, ZEN).post(`/studios/${ZEN}/segments`).send({ name: `M4c e2e zen ${runId}`, kind: 'STATIC' });
      expect(seg.status).toBe(201);
      segmentIds.push(seg.body.id as string);
      const camp = await tenant(zenOwnerToken, ZEN).post(`/studios/${ZEN}/campaigns`).send({ name: `M4c e2e zen ${runId}`, segmentId: seg.body.id, channel: 'SMS', templateKey: 'WIN_BACK' });
      expect(camp.status).toBe(201);
      campaignIds.push(camp.body.id as string);
      const scheduled = await tenant(zenOwnerToken, ZEN).post(`/studios/${ZEN}/campaigns/${camp.body.id}/schedule`).send({ scheduledAt: new Date(Date.now() + 30_000).toISOString() });
      expect(scheduled.status).toBe(201);
      expect((await runScheduler(new Date(Date.now() + 2 * MINUTE))).status).toBe(201);
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: camp.body.id as string } })).status).toBe('SENT');
      expect(await prisma.webhookDelivery.count({ where: { event: 'campaign.sent' } })).toBe(before);
    });

    it('the dispatcher signs each platform delivery with the secret of its own subscription', async () => {
      // Earlier heartbeats already delivered most of them (through the faked HTTPS call); this run takes the rest.
      await app.get(WebhookDispatcherService).dispatchDue(new Date(Date.now() + 5 * MINUTE));
      const calls = deliverSpy.mock.calls as [string, string, { event: string }][];
      for (const event of PLATFORM_WEBHOOK_EVENTS) {
        const call = calls.find(([url]) => url === `https://example.com/m4c-${event}`);
        expect(call).toBeDefined();
        const [, secret, payload] = call!;
        expect(secret).toBe(secrets.get(event));
        expect(payload.event).toBe(event);
        // The header the dispatcher builds for this body and secret verifies with the documented algorithm.
        const body = JSON.stringify(payload);
        expect(verifySignatureHeader(secret, body, buildSignatureHeader(secret, body))).toBe(true);
        expect(verifySignatureHeader('a-different-secret', body, buildSignatureHeader(secret, body))).toBe(false);
      }
      for (const [, secret] of calls) expect(secret).not.toBe('');
      expect(await prisma.webhookDelivery.count({ where: { endpointId: { in: endpointIds }, status: 'PENDING' } })).toBe(0);
    });

    it('the existing tenant events are unchanged for a non-platform tenant', async () => {
      const key = await (async () => {
        const res = await tenant(flowOwnerToken, FLOW).post('/integrations/api-keys').send({ name: 'M4c e2e flow hooks', scopes: ['webhooks.manage'] });
        apiKeyIds.push(res.body.id as string);
        return res.body.plaintext as string;
      })();
      const hook = await withKey(key).post('/v1/public/hooks').send({ targetUrl: 'https://example.com/m4c-flow-lead', event: 'lead.created' });
      expect(hook.status).toBe(201);
      endpointIds.push(hook.body.id as string);
      const lead = await tenant(flowOwnerToken, FLOW).post('/leads').send({ studioId: FLOW, fullName: 'Flow Lead', phone: `+9053977${String(randomInt(0, 100_000)).padStart(5, '0')}`, source: 'OTHER' });
      expect(lead.status).toBe(201);
      const deliveries = await prisma.webhookDelivery.findMany({ where: { endpointId: hook.body.id as string } });
      expect(deliveries).toHaveLength(1);
      // None of the platform events was queued for it.
      expect(await prisma.webhookDelivery.count({ where: { endpointId: hook.body.id as string, event: { in: [...PLATFORM_WEBHOOK_EVENTS] } } })).toBe(0);
    });
  });
});
