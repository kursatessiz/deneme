import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * G1a: studio region settings (GET/PUT /studios/:studioId/region), the
 * currency-change guard once payments exist, tenant isolation on the
 * region endpoint, and webhook signature rejection for the Stripe and
 * Twilio adapters (both run unconfigured in this test env, so every
 * signature is necessarily rejected -- that is exactly what is being
 * proven: a bad/absent signature never reaches the handler's real logic).
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const MEMBER_PHONE = '+905321000016';

describe('Region settings and provider webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;
  let ZEN: string;
  let ownerToken: string;
  let memberToken: string;

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string, body?: unknown) =>
      request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId).send(body ?? {}),
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    ownerToken = await login(OWNER_PHONE);
    memberToken = await login(MEMBER_PHONE);
  });

  afterAll(async () => {
    // Restore the seeded region in case a test left it changed.
    await prisma.studio.update({
      where: { id: ZEN },
      data: { countryCode: 'TR', currency: 'TRY', timezone: 'Europe/Istanbul', taxRegime: 'TR_KDV', pricesIncludeTax: true },
    });
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET/PUT /studios/:studioId/region', () => {
    it('returns the seeded Turkish region for the owner', async () => {
      const res = await as(ownerToken, ZEN).get(`/studios/${ZEN}/region`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ countryCode: 'TR', currency: 'TRY', taxRegime: 'TR_KDV', pricesIncludeTax: true });
    });

    it('403s a member without studio.settings.view', async () => {
      const res = await as(memberToken, ZEN).get(`/studios/${ZEN}/region`);
      expect(res.status).toBe(403);
    });

    it('403s a PUT from a member without studio.settings.manage', async () => {
      const res = await as(memberToken, ZEN).put(`/studios/${ZEN}/region`, {
        countryCode: 'TR',
        currency: 'TRY',
        timezone: 'Europe/Istanbul',
        taxRegime: 'TR_KDV',
        pricesIncludeTax: true,
      });
      expect(res.status).toBe(403);
    });

    it('the owner can update non-currency region fields', async () => {
      const res = await as(ownerToken, ZEN).put(`/studios/${ZEN}/region`, {
        countryCode: 'TR',
        currency: 'TRY',
        timezone: 'Europe/Ankara',
        taxRegime: 'TR_KDV',
        pricesIncludeTax: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.timezone).toBe('Europe/Ankara');
      expect(res.body.pricesIncludeTax).toBe(false);

      // restore immediately so later tests see the seeded shape
      await as(ownerToken, ZEN).put(`/studios/${ZEN}/region`, {
        countryCode: 'TR',
        currency: 'TRY',
        timezone: 'Europe/Istanbul',
        taxRegime: 'TR_KDV',
        pricesIncludeTax: true,
      });
    });

    it('409s a currency change once the studio has a recorded payment', async () => {
      const hasPayment = await prisma.payment.findFirst({ where: { studioId: ZEN } });
      expect(hasPayment).not.toBeNull(); // the seed studio has payment history

      const res = await as(ownerToken, ZEN).put(`/studios/${ZEN}/region`, {
        countryCode: 'TR',
        currency: 'USD',
        timezone: 'Europe/Istanbul',
        taxRegime: 'TR_KDV',
        pricesIncludeTax: true,
      });
      expect(res.status).toBe(409);
    });

    it('rejects an invalid payload (wrong-length currency code)', async () => {
      const res = await as(ownerToken, ZEN).put(`/studios/${ZEN}/region`, {
        countryCode: 'TR',
        currency: 'TR',
        timezone: 'Europe/Istanbul',
        taxRegime: 'TR_KDV',
        pricesIncludeTax: true,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('tenant isolation', () => {
    it('rejects a studio header the caller has no membership in', async () => {
      const otherStudio = await prisma.studio.findFirstOrThrow({ where: { id: { not: ZEN } } });
      const res = await as(ownerToken, otherStudio.id).get(`/studios/${otherStudio.id}/region`);
      expect(res.status).toBe(403);
    });
  });

  describe('Stripe webhook signature rejection', () => {
    it('rejects an unsigned Stripe webhook (unconfigured in this test env, so verification always fails)', async () => {
      const res = await request(server)
        .post('/payments/webhook/stripe')
        .set('Content-Type', 'application/json')
        .send('{"id":"evt_1","type":"payment_intent.succeeded"}');
      expect(res.status).toBe(400);
    });

    it('rejects a Stripe webhook with a garbage signature header', async () => {
      const res = await request(server)
        .post('/payments/webhook/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1700000000,v1=not-a-real-signature')
        .send('{"id":"evt_2","type":"checkout.session.completed"}');
      expect(res.status).toBe(400);
    });
  });

  describe('Twilio status webhook signature rejection', () => {
    it('rejects a status callback without a valid X-Twilio-Signature', async () => {
      const res = await request(server)
        .post('/notifications/webhook/twilio/status')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('x-twilio-signature', 'garbage')
        .send('MessageSid=SM123&MessageStatus=delivered');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ verified: false });
    });

    it('reports unverified when no signature header is sent at all', async () => {
      const res = await request(server)
        .post('/notifications/webhook/twilio/status')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('MessageSid=SM123&MessageStatus=delivered');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ verified: false });
    });
  });
});
