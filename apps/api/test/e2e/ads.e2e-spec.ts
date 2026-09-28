import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient, Prisma } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { AdsHttpClient } from '../../src/modules/ads/ads-http-client';
import { ConversionDeliveryDispatcherService } from '../../src/modules/ads/delivery/conversion-delivery-dispatcher.service';
import { ConversionService } from '../../src/modules/crm/conversions/conversion.service';

/**
 * G2b: ad platform connections (CRUD, permissions, tenant isolation,
 * credentials never returned), the conversion delivery dispatcher (outbox
 * -> Meta CAPI / Google Ads / TikTok Events, consent and match skip
 * reasons, retry scheduling, idempotency, dead-letter) and the attribution
 * report's spend/CPL/CAC/ROAS numbers, all with the HTTP layer mocked at
 * the AdsHttpClient boundary so nothing here calls a real ad platform.
 *
 * Every row lives in the throwaway ZEN/FLOW seed studios and is removed in
 * afterAll, so the suite passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const FLOW_OWNER_PHONE = '+905321000022';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function uuid(seed: number): string {
  const hex = seed.toString(16).padStart(12, '0');
  return `e2e0ad00-0000-4000-8000-${hex}`;
}

describe('Ads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;
  let http: { postJson: jest.Mock; getJson: jest.Mock };

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let receptionToken: string;
  let flowOwnerToken: string;

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const cleanup = async () => {
    await prisma.conversionDelivery.deleteMany({ where: { studioId: ZEN } });
    await prisma.conversionEvent.deleteMany({ where: { studioId: ZEN, sourceId: { startsWith: 'ads-e2e-' } } });
    await prisma.touchpoint.deleteMany({ where: { studioId: ZEN, sessionId: { in: [uuid(1), uuid(2)] } } });
    await prisma.visitor.deleteMany({ where: { studioId: ZEN, id: { in: [uuid(10), uuid(11)] } } });
    await prisma.contact.deleteMany({ where: { studioId: ZEN, phone: { startsWith: '+90539778' } } });
    await prisma.adSpendDaily.deleteMany({ where: { studioId: ZEN } });
    await prisma.adEntity.deleteMany({ where: { studioId: ZEN } });
    await prisma.adConnection.deleteMany({ where: { studioId: { in: [ZEN, FLOW] } } });
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AdsHttpClient)
      .useValue({ postJson: jest.fn(), getJson: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    http = app.get(AdsHttpClient) as unknown as { postJson: jest.Mock; getJson: jest.Mock };

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    await cleanup();

    ownerToken = await login(OWNER_PHONE);
    receptionToken = await login(RECEPTION_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
  });

  afterEach(() => {
    http.postJson.mockReset();
    http.getJson.mockReset();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------

  describe('connections CRUD, permissions and tenant isolation', () => {
    let connectionId: string;

    it('reception (no ads.manage) is refused', async () => {
      const res = await as(receptionToken, ZEN)
        .post(`/studios/${ZEN}/ads/connections`)
        .send({ platform: 'META', label: 'Ana hesap', externalAccountId: 'act_1', credentials: { accessToken: 'EAABsecret1234', pixelId: '999' } });
      expect(res.status).toBe(403);
    });

    it('owner creates a Meta connection; the response never carries the access token, only its last 4 characters', async () => {
      const res = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/ads/connections`)
        .send({ platform: 'META', label: 'Ana hesap', externalAccountId: 'act_1', credentials: { accessToken: 'EAABsecret1234', pixelId: '999' } });
      expect(res.status).toBe(201);
      expect(res.body.credentialLast4).toBe('1234');
      expect(res.body.status).toBe('CONNECTED');
      expect(JSON.stringify(res.body)).not.toContain('EAABsecret1234');
      connectionId = res.body.id;
    });

    it('rejects credentials that do not match the platform shape', async () => {
      const res = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/ads/connections`)
        .send({ platform: 'META', label: 'Eksik', externalAccountId: 'act_2', credentials: { refreshToken: 'x' } });
      expect(res.status).toBe(400);
    });

    it('FLOW owner cannot see or modify ZEN connections (tenant isolation)', async () => {
      const list = await as(flowOwnerToken, FLOW).get(`/studios/${FLOW}/ads/connections`);
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);

      const del = await as(flowOwnerToken, FLOW).delete(`/studios/${FLOW}/ads/connections/${connectionId}`);
      expect(del.status).toBe(404);
    });

    it('updates credentials (last4 changes) and label', async () => {
      const res = await as(ownerToken, ZEN)
        .patch(`/studios/${ZEN}/ads/connections/${connectionId}`)
        .send({ label: 'Ana hesap (güncel)', credentials: { accessToken: 'EAABnewtoken9999', pixelId: '999' } });
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('Ana hesap (güncel)');
      expect(res.body.credentialLast4).toBe('9999');
    });

    it('test-connection calls AdsHttpClient (mocked) and updates lastSyncAt on success', async () => {
      http.getJson.mockResolvedValue({ ok: true, status: 200, body: { id: '999' } });
      const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/ads/connections/${connectionId}/test`);
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(http.getJson).toHaveBeenCalled();
      const row = await prisma.adConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(row.lastSyncAt).not.toBeNull();
    });

    it('test-connection surfaces a platform failure and sets status ERROR', async () => {
      http.getJson.mockResolvedValue({ ok: false, status: 401, body: { error: { message: 'Invalid token' } } });
      const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/ads/connections/${connectionId}/test`);
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(false);
      const row = await prisma.adConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(row.status).toBe('ERROR');
    });

    it('deletes the connection', async () => {
      const res = await as(ownerToken, ZEN).delete(`/studios/${ZEN}/ads/connections/${connectionId}`);
      expect(res.status).toBe(200);
      const row = await prisma.adConnection.findUnique({ where: { id: connectionId } });
      expect(row).toBeNull();
    });

    it('creates a Google connection, its public pixel config exposes only the AW- conversion id, no OAuth secret', async () => {
      const create = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/ads/connections`)
        .send({
          platform: 'GOOGLE',
          label: 'Google Ads',
          externalAccountId: '1112223333',
          credentials: {
            clientId: 'client-id-secret',
            clientSecret: 'client-secret-value',
            refreshToken: '1//refresh-token-secret',
            developerToken: 'dev-token-secret',
            loginCustomerId: '1234567890',
            customerId: '0987654321',
            conversionId: 'AW-123456789',
          },
        });
      expect(create.status).toBe(201);
      expect(JSON.stringify(create.body)).not.toMatch(/secret/);

      const pixels = await request(server).get(`/public/studios/zen-reformer-pilates/ads/pixels`);
      expect(pixels.status).toBe(200);
      expect(pixels.body.google).toEqual({ conversionId: 'AW-123456789' });
      expect(JSON.stringify(pixels.body)).not.toMatch(/secret/);

      await as(ownerToken, ZEN).delete(`/studios/${ZEN}/ads/connections/${create.body.id}`);
    });
  });

  // ---------------------------------------------------------------------------

  describe('conversion delivery dispatcher', () => {
    let connectionId: string;
    let dispatcher: ConversionDeliveryDispatcherService;
    let conversions: ConversionService;
    let contactWithConsentId: string;
    let contactNoConsentId: string;

    beforeAll(async () => {
      dispatcher = app.get(ConversionDeliveryDispatcherService);
      conversions = app.get(ConversionService);

      const created = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/ads/connections`)
        .send({ platform: 'META', label: 'Delivery testi', externalAccountId: 'act_9', credentials: { accessToken: 'EAABdelivery0001', pixelId: '999' } });
      connectionId = created.body.id;

      const visitor1 = await prisma.visitor.create({ data: { studioId: ZEN, id: uuid(10), firstSeenAt: new Date(), lastSeenAt: new Date() } });
      const contactA = await prisma.contact.create({
        data: { studioId: ZEN, firstName: 'Deniz', lastName: 'Kaya', phone: '+905397780001', email: 'deniz@example.com' },
      });
      contactWithConsentId = contactA.id;
      await prisma.touchpoint.create({
        data: {
          studioId: ZEN,
          visitorId: visitor1.id,
          sessionId: uuid(1),
          occurredAt: new Date(),
          landingPath: '/tr/pilates',
          fbc: 'fb.1.1.fbclid-e2e',
          advertisingConsent: true,
          contactId: contactWithConsentId,
        },
      });

      const contactB = await prisma.contact.create({
        data: { studioId: ZEN, firstName: 'Kerem', lastName: 'Sari', phone: '+905397780002', email: 'kerem@example.com' },
      });
      contactNoConsentId = contactB.id;
      // No touchpoint at all for contactB: represents "no advertising consent on record".
    });

    afterAll(async () => {
      await as(ownerToken, ZEN).delete(`/studios/${ZEN}/ads/connections/${connectionId}`);
    });

    it('enqueues a PENDING delivery when the event is recorded (outbox activation)', async () => {
      await conversions.record({
        studioId: ZEN,
        type: 'lead',
        contactId: contactWithConsentId,
        occurredAt: new Date(),
        source: { kind: 'e2e', id: 'ads-e2e-lead-1' },
      });
      const delivery = await prisma.conversionDelivery.findFirstOrThrow({
        where: { studioId: ZEN, conversionEvent: { sourceId: 'ads-e2e-lead-1' } },
      });
      expect(delivery.target).toBe('META_CAPI');
      expect(delivery.status).toBe('PENDING');
    });

    it('dispatches, sends to Meta (mocked) and marks SENT; a second dispatch is a no-op (idempotent)', async () => {
      http.postJson.mockResolvedValue({ ok: true, status: 200, body: { events_received: 1 } });
      const first = await dispatcher.dispatchDue();
      expect(first.sent).toBeGreaterThanOrEqual(1);
      expect(http.postJson).toHaveBeenCalledTimes(1);

      const delivery = await prisma.conversionDelivery.findFirstOrThrow({
        where: { studioId: ZEN, conversionEvent: { sourceId: 'ads-e2e-lead-1' } },
      });
      expect(delivery.status).toBe('SENT');
      expect(delivery.sentAt).not.toBeNull();

      // Already SENT: the next dispatch tick does not pick it up again.
      const second = await dispatcher.dispatchDue();
      expect(http.postJson).toHaveBeenCalledTimes(1);
      expect(second.attempted).toBe(0);
    });

    it('skips with SKIPPED_NO_CONSENT for a contact with no advertising-consented touchpoint', async () => {
      await conversions.record({
        studioId: ZEN,
        type: 'lead',
        contactId: contactNoConsentId,
        occurredAt: new Date(),
        source: { kind: 'e2e', id: 'ads-e2e-lead-2' },
      });
      await dispatcher.dispatchDue();
      const delivery = await prisma.conversionDelivery.findFirstOrThrow({
        where: { studioId: ZEN, conversionEvent: { sourceId: 'ads-e2e-lead-2' } },
      });
      expect(delivery.status).toBe('SKIPPED_NO_CONSENT');
      expect(http.postJson).not.toHaveBeenCalled();
    });

    it('retries a transient failure with backoff, then dead-letters after the last attempt', async () => {
      await conversions.record({
        studioId: ZEN,
        type: 'lead',
        contactId: contactWithConsentId,
        occurredAt: new Date(),
        source: { kind: 'e2e', id: 'ads-e2e-lead-3' },
      });
      http.postJson.mockResolvedValue({ ok: false, status: 500, body: { error: 'boom' } });
      await dispatcher.dispatchDue();

      let delivery = await prisma.conversionDelivery.findFirstOrThrow({ where: { studioId: ZEN, conversionEvent: { sourceId: 'ads-e2e-lead-3' } } });
      expect(delivery.status).toBe('PENDING');
      expect(delivery.attempts).toBe(1);
      expect(delivery.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

      // Force every remaining attempt due immediately and exhaust them.
      for (let i = 1; i < 5; i += 1) {
        await prisma.conversionDelivery.update({ where: { id: delivery.id }, data: { nextAttemptAt: new Date(0) } });
        await dispatcher.dispatchDue();
        delivery = await prisma.conversionDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      }
      expect(delivery.status).toBe('FAILED');
      expect(delivery.nextAttemptAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------

  describe('attribution report: spend, CPL, CAC, ROAS', () => {
    const campaignId = 'e2e-camp-1';

    beforeAll(async () => {
      const visitor = await prisma.visitor.create({ data: { studioId: ZEN, id: uuid(11), firstSeenAt: new Date(), lastSeenAt: new Date() } });
      const contact = await prisma.contact.create({
        data: { studioId: ZEN, firstName: 'Ada', lastName: 'Report', phone: '+905397780003' },
      });
      await prisma.touchpoint.create({
        data: {
          studioId: ZEN,
          visitorId: visitor.id,
          sessionId: uuid(2),
          occurredAt: new Date(),
          landingPath: '/',
          utmSource: 'meta',
          pwCid: campaignId,
          contactId: contact.id,
        },
      });
      const conversions = app.get(ConversionService);
      await conversions.record({
        studioId: ZEN,
        type: 'lead',
        contactId: contact.id,
        occurredAt: new Date(),
        source: { kind: 'e2e', id: 'ads-e2e-report-lead' },
      });
      await conversions.record({
        studioId: ZEN,
        type: 'purchase',
        contactId: contact.id,
        occurredAt: new Date(),
        source: { kind: 'e2e', id: 'ads-e2e-report-purchase' },
        value: { amount: '1000.00', currency: 'TRY' },
      });
      await prisma.adSpendDaily.create({
        data: {
          studioId: ZEN,
          platform: 'META',
          level: 'CAMPAIGN',
          externalId: campaignId,
          date: new Date(),
          spendAmount: new Prisma.Decimal('200.0000'),
          currency: 'TRY',
          impressions: 1000,
          clicks: 40,
        },
      });
    });

    it('matches spend to the campaign row and computes CPL/CAC/ROAS', async () => {
      const from = new Date(Date.now() - DAY).toISOString();
      const to = new Date(Date.now() + DAY).toISOString();
      const res = await as(ownerToken, ZEN).get(`/crm/studios/${ZEN}/attribution?from=${from}&to=${to}&groupBy=campaign`);
      expect(res.status).toBe(200);
      const row = res.body.rows.find((r: any) => r.key === campaignId);
      expect(row).toBeDefined();
      expect(row.spend).toEqual({ TRY: '200.00' });
      // 1 lead -> CPL = 200 / 1 = 200; 1 purchase -> CAC = 200 / 1 = 200; revenue 1000 / spend 200 = 5.
      expect(row.cpl.TRY).toBe(200);
      expect(row.cac.TRY).toBe(200);
      expect(row.roas.TRY).toBe(5);
    });
  });
});
