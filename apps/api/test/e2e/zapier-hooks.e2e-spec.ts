import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { ALL_WEBHOOK_EVENTS } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * G3c-3 REST hooks for automation tools such as Zapier (docs/ZAPIER.md):
 * API key required, subscribing creates an ordinary webhook endpoint bound
 * to one event, SSRF and non-https targets are refused, unsubscribing,
 * sample payloads, the connection test, cross-tenant isolation, and the new
 * domain events reaching a subscribed hook (lead.created and
 * retail.sale.completed). Everything it creates is removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const LEAD_PHONE = '+905399959001'; // must not collide with the seeded +90539996xxxx leads
const PRODUCT_NAME = 'E2E ZAP product';

describe('Zapier REST hooks G3c-3 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let FLOW: string;
  let zenName: string;
  let ownerToken: string;
  let flowOwnerToken: string;
  let hookKey: string;
  let readOnlyKey: string;
  let flowKey: string;
  const apiKeyIds: string[] = [];
  const endpointIds: string[] = [];

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const makeKey = async (token: string, studioId: string, name: string, scopes: string[]) => {
    const res = await request(server).post('/integrations/api-keys').set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId).send({ name, scopes });
    expect(res.status).toBe(201);
    apiKeyIds.push(res.body.id as string);
    return res.body.plaintext as string;
  };
  const withKey = (key: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${key}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${key}`),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${key}`),
  });
  const staff = (token: string, studioId: string) => ({
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const subscribe = async (key: string, event: string, targetUrl = 'https://example.com/zap-e2e') => {
    const res = await withKey(key).post('/v1/public/hooks').send({ targetUrl, event });
    if (res.status === 201) endpointIds.push(res.body.id as string);
    return res;
  };

  async function cleanup() {
    const products = await prisma.product.findMany({ where: { name: PRODUCT_NAME }, select: { id: true } });
    const productIds = products.map((p) => p.id);
    await prisma.sale.deleteMany({ where: { lines: { some: { productId: { in: productIds } } } } });
    await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    const contacts = await prisma.contact.findMany({ where: { phone: LEAD_PHONE }, select: { id: true } });
    const contactIds = contacts.map((c) => c.id);
    await prisma.contactTask.deleteMany({ where: { contactId: { in: contactIds } } });
    await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.webhookDelivery.deleteMany({ where: { endpointId: { in: endpointIds } } });
    await prisma.webhookEndpoint.deleteMany({ where: { id: { in: endpointIds } } });
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'webhooks.rest_hook' }, entityId: { in: endpointIds } } });
    await prisma.apiKey.deleteMany({ where: { id: { in: apiKeyIds } } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = zen.id;
    zenName = zen.name;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    ownerToken = await login('+905321000002');
    flowOwnerToken = await login('+905321000022');
    await prisma.contact.deleteMany({ where: { phone: LEAD_PHONE } });

    hookKey = await makeKey(ownerToken, ZEN, 'E2E zap hooks', ['webhooks.manage']);
    readOnlyKey = await makeKey(ownerToken, ZEN, 'E2E zap read only', ['schedules.read']);
    flowKey = await makeKey(flowOwnerToken, FLOW, 'E2E zap flow hooks', ['webhooks.manage']);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('authentication', () => {
    it('requires an API key on every hook endpoint', async () => {
      expect((await request(server).post('/v1/public/hooks').send({ targetUrl: 'https://example.com/x', event: 'lead.created' })).status).toBe(401);
      expect((await request(server).delete('/v1/public/hooks/3f0b6c1e-2b7a-4a3c-9d55-0a1b2c3d4e01')).status).toBe(401);
      expect((await request(server).get('/v1/public/hooks/samples/lead.created')).status).toBe(401);
      expect((await request(server).get('/v1/public/me')).status).toBe(401);
      expect((await request(server).get('/v1/public/me').set('Authorization', 'Bearer pk_live_nope')).status).toBe(401);
    });

    it('subscribing needs the webhooks.manage scope, the connection test and samples do not', async () => {
      expect((await withKey(readOnlyKey).post('/v1/public/hooks').send({ targetUrl: 'https://example.com/x', event: 'lead.created' })).status).toBe(403);
      expect((await withKey(readOnlyKey).get('/v1/public/me')).status).toBe(200);
      expect((await withKey(readOnlyKey).get('/v1/public/hooks/samples/lead.created')).status).toBe(200);
    });

    it('a staff JWT is not an API key', async () => {
      const res = await request(server).get('/v1/public/me').set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(401);
    });
  });

  describe('connection test', () => {
    it('returns the studio of the key', async () => {
      const zen = await withKey(hookKey).get('/v1/public/me');
      expect(zen.status).toBe(200);
      expect(zen.body).toMatchObject({ studioId: ZEN, name: zenName });
      expect(zen.body.scopes).toEqual(['webhooks.manage']);
      const flow = await withKey(flowKey).get('/v1/public/me');
      expect(flow.body.studioId).toBe(FLOW);
    });
  });

  describe('subscribe and unsubscribe', () => {
    it('creates a webhook endpoint for exactly one event', async () => {
      const res = await subscribe(hookKey, 'lead.created', 'https://example.com/zap-e2e-one');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ event: 'lead.created', targetUrl: 'https://example.com/zap-e2e-one' });
      expect(res.body.secret).toMatch(/^whsec_/);
      const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row).toMatchObject({ studioId: ZEN, url: 'https://example.com/zap-e2e-one', events: ['lead.created'], isActive: true });
    });

    it('refuses non-https, private and metadata targets and unknown events', async () => {
      expect((await subscribe(hookKey, 'lead.created', 'http://example.com/x')).status).toBe(400);
      expect((await subscribe(hookKey, 'lead.created', 'https://127.0.0.1/hook')).status).toBe(400);
      expect((await subscribe(hookKey, 'lead.created', 'https://localhost/hook')).status).toBe(400);
      expect((await subscribe(hookKey, 'lead.created', 'https://169.254.169.254/latest/meta-data')).status).toBe(400);
      expect((await subscribe(hookKey, 'lead.created', 'https://10.0.0.5/hook')).status).toBe(400);
      expect((await subscribe(hookKey, 'lead.created', 'https://[::1]/hook')).status).toBe(400);
      expect((await subscribe(hookKey, 'not.an.event')).status).toBe(400);
      expect((await withKey(hookKey).post('/v1/public/hooks').send({ event: 'lead.created' })).status).toBe(400);
    });

    it('deletes a subscription once, then answers 404', async () => {
      const created = await subscribe(hookKey, 'member.created', 'https://example.com/zap-e2e-delete');
      expect(created.status).toBe(201);
      const first = await withKey(hookKey).delete(`/v1/public/hooks/${created.body.id}`);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ deleted: true });
      expect(await prisma.webhookEndpoint.findUnique({ where: { id: created.body.id } })).toBeNull();
      expect((await withKey(hookKey).delete(`/v1/public/hooks/${created.body.id}`)).status).toBe(404);
      expect((await withKey(hookKey).delete('/v1/public/hooks/not-a-uuid')).status).toBe(400);
    });

    it('a key of another studio cannot delete a hook, in either direction', async () => {
      const zenHook = await subscribe(hookKey, 'booking.created', 'https://example.com/zap-e2e-zen');
      const flowHook = await subscribe(flowKey, 'booking.created', 'https://example.com/zap-e2e-flow');
      expect(zenHook.status).toBe(201);
      expect(flowHook.status).toBe(201);

      expect((await withKey(flowKey).delete(`/v1/public/hooks/${zenHook.body.id}`)).status).toBe(404);
      expect((await withKey(hookKey).delete(`/v1/public/hooks/${flowHook.body.id}`)).status).toBe(404);
      expect(await prisma.webhookEndpoint.count({ where: { id: { in: [zenHook.body.id, flowHook.body.id] } } })).toBe(2);

      expect((await withKey(hookKey).delete(`/v1/public/hooks/${zenHook.body.id}`)).status).toBe(200);
      expect((await withKey(flowKey).delete(`/v1/public/hooks/${flowHook.body.id}`)).status).toBe(200);
    });
  });

  describe('sample payloads', () => {
    it('serves a delivery-shaped sample for every event', async () => {
      for (const event of ALL_WEBHOOK_EVENTS) {
        const res = await withKey(hookKey).get(`/v1/public/hooks/samples/${event}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ event, studioId: ZEN });
        expect(typeof res.body.occurredAt).toBe('string');
        expect(Object.keys(res.body.data).length).toBeGreaterThan(0);
      }
    });

    it('includes every event the automation tools need', () => {
      for (const event of ['member.created', 'booking.created', 'booking.cancelled', 'payment.completed', 'payment.refunded', 'lead.created', 'event.registration.created', 'retail.sale.completed']) {
        expect(ALL_WEBHOOK_EVENTS).toContain(event);
      }
    });

    it('answers 400 for an unknown event', async () => {
      expect((await withKey(hookKey).get('/v1/public/hooks/samples/nope')).status).toBe(400);
    });
  });

  describe('new domain events reach a subscribed hook', () => {
    it('lead.created is queued when staff add a lead', async () => {
      const hook = await subscribe(hookKey, 'lead.created', 'https://example.com/zap-e2e-lead');
      expect(hook.status).toBe(201);
      const lead = await staff(ownerToken, ZEN).post('/leads').send({ studioId: ZEN, fullName: 'Zap Lead', phone: LEAD_PHONE, source: 'OTHER' });
      expect(lead.status).toBe(201);
      const deliveries = await prisma.webhookDelivery.findMany({ where: { endpointId: hook.body.id } });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({ event: 'lead.created', status: 'PENDING' });
      const payload = deliveries[0].payload as { event: string; studioId: string; data: { fullName: string; phone: string; source: string } };
      expect(payload).toMatchObject({ event: 'lead.created', studioId: ZEN, data: { fullName: 'Zap Lead', phone: LEAD_PHONE, source: 'OTHER' } });
    });

    it('retail.sale.completed is queued for a desk sale and only for subscribed studios', async () => {
      const zenHook = await subscribe(hookKey, 'retail.sale.completed', 'https://example.com/zap-e2e-sale');
      const flowHook = await subscribe(flowKey, 'retail.sale.completed', 'https://example.com/zap-e2e-sale-flow');
      const branch = await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN, isActive: true }, orderBy: { createdAt: 'asc' } });
      const product = await staff(ownerToken, ZEN).post(`/studios/${ZEN}/retail/products`).send({ name: PRODUCT_NAME, price: '12.00', trackStock: false });
      expect(product.status).toBe(201);
      const sale = await staff(ownerToken, ZEN)
        .post(`/studios/${ZEN}/retail/sales`)
        .send({ branchId: branch.id, lines: [{ productId: product.body.id, quantity: 2 }], paymentMethod: 'CASH' });
      expect(sale.status).toBe(201);

      const zenDeliveries = await prisma.webhookDelivery.findMany({ where: { endpointId: zenHook.body.id } });
      expect(zenDeliveries).toHaveLength(1);
      const payload = zenDeliveries[0].payload as { data: { saleId: string; receiptNumber: string; total: string; currency: string } };
      expect(payload.data).toMatchObject({ saleId: sale.body.id, receiptNumber: sale.body.receiptNumber, total: sale.body.total, currency: sale.body.currency });
      expect(await prisma.webhookDelivery.count({ where: { endpointId: flowHook.body.id } })).toBe(0);
    });
  });
});
