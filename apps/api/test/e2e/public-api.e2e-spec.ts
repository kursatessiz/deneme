import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { buildSignatureHeader, verifySignatureHeader } from '../../src/modules/webhooks/webhook-signature';
import { AppModule } from '../../src/app.module';

/**
 * W18: open platform. API key issuance/revocation, the API-key-authenticated
 * `/v1/public/*` API (scopes, cross-tenant isolation, phone masking, the
 * schedules date-range limit, booking create/cancel), outbound webhooks
 * (SSRF rejection on create, an emitted delivery row, signature
 * verification, a manual test event), permission denials for staff without
 * integrations.manage, and the unauthenticated embed widget surface (which
 * is read-only and never returns member data; a security review found the
 * original embed write endpoints let anyone who knew a member's phone
 * number book or cancel on their behalf, so they were removed -- see
 * docs/PUBLIC_API.md "Embed widget"). Cleans up everything it creates.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';

describe('Public API and webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;
  let matServiceTypeId: string;
  let flowServiceTypeId: string;

  const apiKeyIds: string[] = [];
  const webhookEndpointIds: string[] = [];
  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];
  const EMBED_LEAD_PHONE_PREFIX = '+90539998'; // + '1234' below -> 12-digit valid Turkish mobile (905 + 9 digits)

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  const staff = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const pub = (key: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${key}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${key}`),
  });

  const makeSchedule = async (studioId: string, serviceTypeId: string, startInHours: number) => {
    const start = new Date(Date.now() + startInHours * HOUR);
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId,
        serviceTypeId,
        title: 'W18 e2e schedule',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity: 10,
      },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    matServiceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, name: 'Mat Pilates' } })).id;
    flowServiceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: FLOW } })).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.webhookDelivery.deleteMany({ where: { endpointId: { in: webhookEndpointIds } } });
    await prisma.webhookEndpoint.deleteMany({ where: { id: { in: webhookEndpointIds } } });
    await prisma.apiKey.deleteMany({ where: { id: { in: apiKeyIds } } });
    const embedLeads = await prisma.lead.findMany({
      where: { studioId: ZEN, phone: { startsWith: EMBED_LEAD_PHONE_PREFIX } },
      select: { id: true },
    });
    const embedLeadIds = embedLeads.map((l) => l.id);
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: embedLeadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: embedLeadIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // API key issuance
  // ---------------------------------------------------------------------------

  describe('embed settings (GET/PUT /studios/:studioId/embed-settings)', () => {
    let originalOrigins: string[];

    beforeAll(async () => {
      originalOrigins = (await prisma.studio.findUniqueOrThrow({ where: { id: ZEN }, select: { embedAllowedOrigins: true } }))
        .embedAllowedOrigins;
    });

    afterAll(async () => {
      await prisma.studio.update({ where: { id: ZEN }, data: { embedAllowedOrigins: originalOrigins } });
    });

    it('owner reads back the origins that a previous PUT stored, instead of an empty default', async () => {
      const put = await staff(ownerToken, ZEN).put('/studios/' + ZEN + '/embed-settings').send({ embedAllowedOrigins: ['https://e2e-embed-read.example.com'] });
      expect(put.status).toBe(200);

      const get = await staff(ownerToken, ZEN).get(`/studios/${ZEN}/embed-settings`);
      expect(get.status).toBe(200);
      expect(get.body.embedAllowedOrigins).toEqual(['https://e2e-embed-read.example.com']);
    });

    it('trainer and member cannot read embed settings (integrations.manage denied)', async () => {
      const asTrainer = await staff(trainerToken, ZEN).get(`/studios/${ZEN}/embed-settings`);
      expect(asTrainer.status).toBe(403);
      const asMember = await staff(memberToken, ZEN).get(`/studios/${ZEN}/embed-settings`);
      expect(asMember.status).toBe(403);
    });

    it('a studio owner cannot read another studio\'s embed settings (tenant isolation)', async () => {
      const res = await staff(ownerToken, ZEN).get(`/studios/${FLOW}/embed-settings`);
      expect(res.status).toBe(403);
    });
  });

  describe('API key management', () => {
    it('owner creates a key: the plaintext secret is shown exactly once', async () => {
      const res = await staff(ownerToken, ZEN)
        .post('/integrations/api-keys')
        .send({ name: 'E2E full access', scopes: ['schedules.read', 'bookings.read', 'bookings.write', 'members.read'] });
      expect(res.status).toBe(201);
      expect(res.body.plaintext).toMatch(/^pk_live_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
      expect(res.body.prefix).toHaveLength(8);
      apiKeyIds.push(res.body.id);
    });

    it('the list endpoint never returns a secret or plaintext field', async () => {
      const res = await staff(ownerToken, ZEN).get('/integrations/api-keys');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const key of res.body) {
        expect(key).not.toHaveProperty('secretHash');
        expect(key).not.toHaveProperty('plaintext');
        expect(key).not.toHaveProperty('secret');
      }
    });

    it('trainer and member cannot manage API keys (integrations.manage denied)', async () => {
      const asTrainer = await staff(trainerToken, ZEN).get('/integrations/api-keys');
      expect(asTrainer.status).toBe(403);
      const asMember = await staff(memberToken, ZEN).get('/integrations/api-keys');
      expect(asMember.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // /v1/public/* : auth, scopes, isolation, reads, writes
  // ---------------------------------------------------------------------------

  describe('/v1/public/*', () => {
    let fullKey: string;
    let readOnlyKey: string; // no members.read, no bookings.write
    let revokedKey: string;
    let expiredKey: string;

    beforeAll(async () => {
      const full = await staff(ownerToken, ZEN)
        .post('/integrations/api-keys')
        .send({ name: 'E2E public API full', scopes: ['schedules.read', 'bookings.read', 'bookings.write', 'members.read'] });
      fullKey = full.body.plaintext;
      apiKeyIds.push(full.body.id);

      const readOnly = await staff(ownerToken, ZEN)
        .post('/integrations/api-keys')
        .send({ name: 'E2E public API read-only', scopes: ['schedules.read', 'bookings.read'] });
      readOnlyKey = readOnly.body.plaintext;
      apiKeyIds.push(readOnly.body.id);

      const toRevoke = await staff(ownerToken, ZEN)
        .post('/integrations/api-keys')
        .send({ name: 'E2E to revoke', scopes: ['schedules.read'] });
      revokedKey = toRevoke.body.plaintext;
      apiKeyIds.push(toRevoke.body.id);
      await staff(ownerToken, ZEN).delete(`/integrations/api-keys/${toRevoke.body.id}`).expect(200);

      const expired = await staff(ownerToken, ZEN)
        .post('/integrations/api-keys')
        .send({ name: 'E2E expired', scopes: ['schedules.read'], expiresAt: new Date(Date.now() - HOUR).toISOString() });
      expiredKey = expired.body.plaintext;
      apiKeyIds.push(expired.body.id);
    });

    it('rejects a missing or malformed Authorization header', async () => {
      await request(server).get('/v1/public/branches').expect(401);
      await request(server).get('/v1/public/branches').set('Authorization', 'Bearer not-a-key').expect(401);
    });

    it('rejects a revoked key with 401', async () => {
      await pub(revokedKey).get('/v1/public/branches').expect(401);
    });

    it('rejects an expired key with 401', async () => {
      await pub(expiredKey).get('/v1/public/branches').expect(401);
    });

    it('lists branches and service types for the key`s own studio', async () => {
      const branches = await pub(fullKey).get('/v1/public/branches').expect(200);
      expect(Array.isArray(branches.body)).toBe(true);

      const serviceTypes = await pub(fullKey).get('/v1/public/service-types').expect(200);
      expect(serviceTypes.body.some((s: { id: string }) => s.id === matServiceTypeId)).toBe(true);
    });

    it('enforces per-endpoint scopes with 403, not 401', async () => {
      // readOnlyKey has schedules.read + bookings.read, but not bookings.write.
      const res = await pub(readOnlyKey).post('/v1/public/bookings').send({ scheduleId: 'x', memberPhone: MEMBER_PHONE });
      expect(res.status).toBe(403);
    });

    it('a schedules range over 31 days is rejected', async () => {
      const from = new Date();
      const to = new Date(from.getTime() + 32 * DAY);
      const res = await pub(fullKey).get(`/v1/public/schedules?from=${from.toISOString()}&to=${to.toISOString()}`);
      expect(res.status).toBe(400);
    });

    it('a 31-day-or-less schedules range succeeds', async () => {
      const scheduleId = await makeSchedule(ZEN, matServiceTypeId, 5);
      const from = new Date(Date.now() - HOUR);
      const to = new Date(Date.now() + 10 * DAY);
      const res = await pub(fullKey).get(`/v1/public/schedules?from=${from.toISOString()}&to=${to.toISOString()}`);
      expect(res.status).toBe(200);
      expect(res.body.some((s: { id: string }) => s.id === scheduleId)).toBe(true);
    });

    it('a key only ever sees its own studio`s data (cross-tenant isolation)', async () => {
      const zenServiceTypes = await pub(fullKey).get('/v1/public/service-types').expect(200);
      expect(zenServiceTypes.body.some((s: { id: string }) => s.id === flowServiceTypeId)).toBe(false);
    });

    it('creates and cancels a booking for an existing member by phone, and masks the phone without members.read', async () => {
      const scheduleId = await makeSchedule(ZEN, matServiceTypeId, 6);

      const created = await pub(fullKey).post('/v1/public/bookings').send({ scheduleId, memberPhone: MEMBER_PHONE });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('CONFIRMED');
      bookingIds.push(created.body.id);

      const listMasked = await pub(readOnlyKey).get(`/v1/public/bookings?scheduleId=${scheduleId}`).expect(200);
      const maskedRow = listMasked.body.items.find((b: { id: string }) => b.id === created.body.id);
      expect(maskedRow.member.phone).not.toBe(MEMBER_PHONE);
      expect(maskedRow.member.phone).toContain('***');

      const listUnmasked = await pub(fullKey).get(`/v1/public/bookings?scheduleId=${scheduleId}`).expect(200);
      const unmaskedRow = listUnmasked.body.items.find((b: { id: string }) => b.id === created.body.id);
      expect(unmaskedRow.member.phone).toBe(MEMBER_PHONE);

      const cancelled = await pub(fullKey).post(`/v1/public/bookings/${created.body.id}/cancel`).send({ reason: 'e2e' });
      expect(cancelled.status).toBe(200);
      expect(['CANCELLED_EARLY', 'CANCELLED_LATE']).toContain(cancelled.body.booking.status);
    });

    it('a phone with no matching active member is rejected', async () => {
      const scheduleId = await makeSchedule(ZEN, matServiceTypeId, 7);
      const res = await pub(fullKey).post('/v1/public/bookings').send({ scheduleId, memberPhone: '+905000000099' });
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  describe('webhooks', () => {
    it('rejects a non-https URL', async () => {
      const res = await staff(ownerToken, ZEN)
        .post('/integrations/webhooks')
        .send({ url: 'http://example.com/hook', events: ['booking.created'] });
      expect(res.status).toBe(400);
    });

    it('rejects a URL resolving to a private/loopback IP (SSRF)', async () => {
      const loopback = await staff(ownerToken, ZEN)
        .post('/integrations/webhooks')
        .send({ url: 'https://127.0.0.1/hook', events: ['booking.created'] });
      expect(loopback.status).toBe(400);

      const metadata = await staff(ownerToken, ZEN)
        .post('/integrations/webhooks')
        .send({ url: 'https://169.254.169.254/hook', events: ['booking.created'] });
      expect(metadata.status).toBe(400);
    });

    it('creates a webhook endpoint with a secret shown once, and a booking.created event enqueues a delivery row', async () => {
      const created = await staff(ownerToken, ZEN)
        .post('/integrations/webhooks')
        .send({ url: 'https://example.com/w18-e2e-hook', events: ['booking.created', 'booking.cancelled'] });
      expect(created.status).toBe(201);
      expect(created.body.secret).toMatch(/^whsec_/);
      webhookEndpointIds.push(created.body.id);

      // Trigger booking.created through the staff booking endpoint, which
      // shares the same SchedulesService.bookSession() emit call as the
      // public API.
      const scheduleId = await makeSchedule(ZEN, matServiceTypeId, 8);
      const memberProfile = await prisma.memberProfile.findFirstOrThrow({
        where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } },
      });
      const booking = await staff(ownerToken, ZEN)
        .post('/schedules/book')
        .send({ studioId: ZEN, scheduleId, memberId: memberProfile.id, resourceIds: [] });
      expect(booking.status).toBe(201);
      bookingIds.push(booking.body.id);

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { endpointId: created.body.id, event: 'booking.created' },
      });
      expect(deliveries.length).toBeGreaterThan(0);
      expect(deliveries[0].status).toBe('PENDING');
      const payload = deliveries[0].payload as { data: { bookingId: string } };
      expect(payload.data.bookingId).toBe(booking.body.id);
    });

    it('a manual test event creates a delivery row without an api key', async () => {
      const endpoint = await staff(ownerToken, ZEN)
        .post('/integrations/webhooks')
        .send({ url: 'https://example.com/w18-e2e-test-event', events: ['member.created'] });
      webhookEndpointIds.push(endpoint.body.id);

      const testEvent = await staff(ownerToken, ZEN)
        .post(`/integrations/webhooks/${endpoint.body.id}/test-event`)
        .send({ event: 'member.created' });
      expect(testEvent.status).toBe(201);
      expect(testEvent.body.status).toBe('PENDING');

      const deliveries = await staff(ownerToken, ZEN).get(`/integrations/webhooks/${endpoint.body.id}/deliveries`);
      expect(deliveries.status).toBe(200);
      expect(deliveries.body.total).toBeGreaterThan(0);
    });

    it('trainer and member cannot manage webhooks (integrations.manage denied)', async () => {
      const asTrainer = await staff(trainerToken, ZEN).get('/integrations/webhooks');
      expect(asTrainer.status).toBe(403);
      const asMember = await staff(memberToken, ZEN).get('/integrations/webhooks');
      expect(asMember.status).toBe(403);
    });

    it('signature header verifies with the endpoint`s own secret, and fails with any other secret', async () => {
      const secretRes = await staff(ownerToken, ZEN)
        .post('/integrations/webhooks')
        .send({ url: 'https://example.com/w18-e2e-signature', events: ['booking.created'] });
      webhookEndpointIds.push(secretRes.body.id);
      const secret: string = secretRes.body.secret;

      const body = JSON.stringify({ event: 'booking.created', data: { id: 'x' } });
      const header = buildSignatureHeader(secret, body);
      expect(verifySignatureHeader(secret, body, header)).toBe(true);
      expect(verifySignatureHeader('wrong-secret', body, header)).toBe(false);
    });

    it('rotating a secret returns a new one and invalidates the old one', async () => {
      const created = await staff(ownerToken, ZEN)
        .post('/integrations/webhooks')
        .send({ url: 'https://example.com/w18-e2e-rotate', events: ['booking.created'] });
      webhookEndpointIds.push(created.body.id);
      const oldSecret: string = created.body.secret;

      const rotated = await staff(ownerToken, ZEN).post(`/integrations/webhooks/${created.body.id}/rotate-secret`);
      expect(rotated.status).toBe(201);
      expect(rotated.body.secret).not.toBe(oldSecret);

      const body = JSON.stringify({ test: true });
      const headerWithOldSecret = buildSignatureHeader(oldSecret, body);
      expect(verifySignatureHeader(rotated.body.secret, body, headerWithOldSecret)).toBe(false);
      const headerWithNewSecret = buildSignatureHeader(rotated.body.secret, body);
      expect(verifySignatureHeader(rotated.body.secret, body, headerWithNewSecret)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Embed widget: unauthenticated, read-only, IP rate-limited. No booking
  // write endpoint exists here (removed after a security review -- see
  // docs/PUBLIC_API.md "Embed widget"); a first-time visitor is routed to
  // the existing public lead form instead.
  // ---------------------------------------------------------------------------

  describe('embed widget (/public/studios/:slug/embed/*)', () => {
    it('exposes config, branches, service-types and schedules with no auth required', async () => {
      const config = await request(server).get(`/public/studios/zen-reformer-pilates/embed/config`);
      expect(config.status).toBe(200);
      expect(config.body.name).toBeTruthy();

      const branches = await request(server).get(`/public/studios/zen-reformer-pilates/embed/branches`);
      expect(branches.status).toBe(200);

      const serviceTypes = await request(server).get(`/public/studios/zen-reformer-pilates/embed/service-types`);
      expect(serviceTypes.status).toBe(200);
      expect(serviceTypes.body.some((s: { id: string }) => s.id === matServiceTypeId)).toBe(true);
    });

    it('the schedules listing never includes member, attendee or booking data', async () => {
      await makeSchedule(ZEN, matServiceTypeId, 9);
      const from = new Date(Date.now() - HOUR);
      const to = new Date(Date.now() + 10 * DAY);
      const res = await request(server).get(
        `/public/studios/zen-reformer-pilates/embed/schedules?from=${from.toISOString()}&to=${to.toISOString()}`,
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const allowedKeys = new Set(['id', 'branchId', 'serviceTypeId', 'title', 'startTime', 'endTime', 'capacity', 'bookedCount']);
      for (const schedule of res.body) {
        for (const key of Object.keys(schedule)) {
          expect(allowedKeys.has(key)).toBe(true);
        }
        // Explicitly assert none of the fields a member-data leak would use are present.
        expect(schedule).not.toHaveProperty('bookings');
        expect(schedule).not.toHaveProperty('member');
        expect(schedule).not.toHaveProperty('members');
        expect(schedule).not.toHaveProperty('trainer');
        expect(schedule).not.toHaveProperty('meetingLink');
        expect(JSON.stringify(schedule)).not.toContain(MEMBER_PHONE);
      }
    });

    it('the booking create and cancel routes no longer exist (removed as a security fix)', async () => {
      const scheduleId = await makeSchedule(ZEN, matServiceTypeId, 11);

      const create = await request(server)
        .post(`/public/studios/zen-reformer-pilates/embed/bookings`)
        .send({ scheduleId, memberPhone: MEMBER_PHONE });
      expect(create.status).toBe(404);

      const cancel = await request(server).post(`/public/studios/zen-reformer-pilates/embed/bookings/${scheduleId}/cancel`).send({});
      expect(cancel.status).toBe(404);
    });

    it('a first-time visitor reaches the widget through the existing public lead form, not a booking', async () => {
      const phone = `${EMBED_LEAD_PHONE_PREFIX}1234`;
      const res = await request(server).post('/public/studios/zen-reformer-pilates/leads').send({
        fullName: 'W18 Embed E2E Ziyaretçi',
        phone,
        interest: 'Web widget üzerinden deneme dersi talebi: Mat Pilates',
        consent: true,
        website: '',
      });
      expect(res.status).toBe(202);

      const lead = await prisma.lead.findFirst({ where: { studioId: ZEN, phone } });
      expect(lead).not.toBeNull();
      expect(lead?.sourceDetail).toContain('deneme dersi');
    });
  });
});
