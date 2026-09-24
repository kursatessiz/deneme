import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { createHmac, randomUUID } from 'crypto';
import { PrismaClient, BookingStatus } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W20: aggregator/marketplace partner integrations. Connection CRUD never
 * leaks credentials, the inbound webhook requires a valid HMAC signature,
 * partner reservations are idempotent and respect both session capacity and
 * the partner's own spot quota under concurrency, partner cancellations
 * follow the partner's own policy, and attended partner visits show up in
 * the payout report. Builds its own connection and session schedule so it
 * never depends on (or alters) seed data, and removes everything it created.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const HOUR = 3600_000;

function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

describe('Partners (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;

  let serviceTypeId: string;

  const connectionIds: string[] = [];
  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];
  const partnerGuestIds: string[] = [];
  const placeholderUserIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string, body?: unknown) =>
      request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId).send(body ?? {}),
    patch: (url: string, body?: unknown) =>
      request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId).send(body ?? {}),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const makeConnection = async (label: string, spotsPerSession = 1, payoutRatePerVisit = '50.00') => {
    const res = await as(ownerToken).post('/partners/connections', {
      provider: 'MOCK',
      label,
      credentials: { webhookSecret: `whsec_${label}`, apiKey: 'k' },
      config: { spotsPerSession, payoutRatePerVisit, releaseHoursBeforeStart: 1 },
    });
    expect(res.status).toBe(201);
    connectionIds.push(res.body.id);
    return res.body as { id: string };
  };

  const makeSchedule = async (capacity: number, startInHours = 48) => {
    const start = new Date(Date.now() + startInHours * HOUR);
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        serviceTypeId,
        title: 'E2E partner session',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity,
      },
    });
    scheduleIds.push(s.id);
    return s;
  };

  const sendWebhook = (
    connectionId: string,
    secret: string,
    body: Record<string, unknown>,
    opts?: { signature?: string; timestamp?: string; skipHeaders?: boolean },
  ) => {
    const rawBody = JSON.stringify(body);
    const timestamp = opts?.timestamp ?? new Date().toISOString();
    const signature = opts?.signature ?? signWebhook(secret, timestamp, rawBody);
    const req = request(server).post(`/partners/mock/webhook/${connectionId}`);
    if (!opts?.skipHeaders) {
      req.set('x-partner-signature', signature).set('x-partner-timestamp', timestamp);
    }
    return req.send(body);
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN } })).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.partnerGuest.deleteMany({ where: { id: { in: partnerGuestIds } } });
    await prisma.partnerSpotAllocation.deleteMany({ where: { connectionId: { in: connectionIds } } });
    await prisma.partnerWebhookEvent.deleteMany({ where: { connectionId: { in: connectionIds } } });
    await prisma.membership.deleteMany({ where: { userId: { in: placeholderUserIds } } });
    await prisma.memberProfile.deleteMany({ where: { membership: { userId: { in: placeholderUserIds } } } });
    await prisma.user.deleteMany({ where: { id: { in: placeholderUserIds } } });
    await prisma.partnerConnection.deleteMany({ where: { id: { in: connectionIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.auditLog.deleteMany({ where: { studioId: ZEN, entityType: { in: ['PartnerConnection', 'Booking'] } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('connection CRUD', () => {
    it('creates a connection and never returns the credentials back', async () => {
      const res = await as(ownerToken).post('/partners/connections', {
        provider: 'MOCK',
        label: 'ClassPass test',
        credentials: { webhookSecret: 'whsec_super_secret_value', apiKey: 'my-api-key' },
        config: { spotsPerSession: 2 },
      });
      expect(res.status).toBe(201);
      connectionIds.push(res.body.id);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('whsec_super_secret_value');
      expect(body).not.toContain('my-api-key');
      expect(res.body.hasCredentials).toBe(true);
      expect(res.body).not.toHaveProperty('credentials');
      expect(res.body).not.toHaveProperty('encryptedCredentials');

      const dbRow = await prisma.partnerConnection.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(dbRow.encryptedCredentials).not.toContain('whsec_super_secret_value');
    });

    it('lists connections without ever including credentials', async () => {
      const res = await as(ownerToken).get('/partners/connections');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('whsec_super_secret_value');
      expect(res.body.every((c: any) => !('credentials' in c) && !('encryptedCredentials' in c))).toBe(true);
    });

    it('updates status and config, still without leaking credentials', async () => {
      const created = await makeConnection('update-target');
      const res = await as(ownerToken).patch(`/partners/connections/${created.id}`, { status: 'PAUSED' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PAUSED');
      expect(res.body).not.toHaveProperty('credentials');
    });

    it('a trainer cannot manage partner connections (needs integrations.partners.manage)', async () => {
      const res = await as(trainerToken).post('/partners/connections', {
        provider: 'MOCK',
        label: 'trainer-attempt',
        credentials: { webhookSecret: 'x' },
      });
      expect(res.status).toBe(403);
    });

    it('cross-tenant: an owner with no membership in another studio cannot list its connections', async () => {
      const res = await as(ownerToken, FLOW).get('/partners/connections');
      expect(res.status).toBe(403);
    });
  });

  describe('webhook signature verification', () => {
    it('requires a signature header', async () => {
      const connection = await makeConnection('sig-required');
      const res = await sendWebhook(
        connection.id,
        'whsec_sig-required',
        { eventId: randomUUID(), eventType: 'RESERVATION_CREATED', timestamp: new Date().toISOString(), externalReservationId: 'x' },
        { skipHeaders: true },
      );
      expect(res.status).toBe(400);
    });

    it('rejects a wrong signature (tampered or wrong secret)', async () => {
      const connection = await makeConnection('sig-wrong');
      const res = await sendWebhook(
        connection.id,
        'not-the-real-secret',
        { eventId: randomUUID(), eventType: 'RESERVATION_CREATED', timestamp: new Date().toISOString(), externalReservationId: 'x' },
      );
      expect(res.status).toBe(400);
    });

    it('rejects a signature whose timestamp is outside the 5 minute tolerance', async () => {
      const connection = await makeConnection('sig-expired');
      const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const body = { eventId: randomUUID(), eventType: 'RESERVATION_CREATED', timestamp: oldTimestamp, externalReservationId: 'x' };
      const res = await sendWebhook(connection.id, 'whsec_sig-expired', body, { timestamp: oldTimestamp });
      expect(res.status).toBe(400);
    });
  });

  describe('reservation lifecycle', () => {
    it('creates a booking without any onboarding, is idempotent by externalReservationId, and check-in feeds the payout report', async () => {
      const connection = await makeConnection('lifecycle', 3, '50.00');
      const schedule = await makeSchedule(5);
      const externalReservationId = `res_${randomUUID()}`;
      const eventId = randomUUID();
      const body = {
        eventId,
        eventType: 'RESERVATION_CREATED',
        timestamp: new Date().toISOString(),
        externalReservationId,
        scheduleId: schedule.id,
        guest: { fullName: 'Ayse Partner Misafiri', phone: '+905550001122' },
      };

      const res1 = await sendWebhook(connection.id, `whsec_lifecycle`, body);
      expect(res1.status).toBe(200);
      expect(res1.body.idempotent).toBe(false);
      bookingIds.push(res1.body.bookingId);

      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: res1.body.bookingId } });
      expect(booking.status).toBe(BookingStatus.CONFIRMED);
      expect(booking.partnerConnectionId).toBe(connection.id);
      if (booking.partnerGuestId) partnerGuestIds.push(booking.partnerGuestId);
      placeholderUserIds.push((await prisma.memberProfile.findUniqueOrThrow({ where: { id: booking.memberId } }).then((m) => prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId } }))).userId);

      const scheduleAfter = await prisma.sessionSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      expect(scheduleAfter.bookedCount).toBe(1);

      // Replay with a different eventId but the same externalReservationId: idempotent, no new booking, no capacity change.
      const res2 = await sendWebhook(connection.id, `whsec_lifecycle`, {
        ...body,
        eventId: randomUUID(),
      });
      expect(res2.status).toBe(200);
      expect(res2.body.idempotent).toBe(true);
      expect(res2.body.bookingId).toBe(res1.body.bookingId);
      const scheduleAfterReplay = await prisma.sessionSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      expect(scheduleAfterReplay.bookedCount).toBe(1);

      // Exact webhook replay (same eventId): also a no-op, protected by PartnerWebhookEvent uniqueness.
      const res3 = await sendWebhook(connection.id, `whsec_lifecycle`, body, {
        timestamp: body.timestamp,
      });
      expect(res3.status).toBe(200);
      const eventCount = await prisma.partnerWebhookEvent.count({ where: { connectionId: connection.id, eventId } });
      expect(eventCount).toBe(1);

      // Check-in: attended, then shows up in the payout report.
      const checkinRes = await sendWebhook(connection.id, `whsec_lifecycle`, {
        eventId: randomUUID(),
        eventType: 'CHECK_IN',
        timestamp: new Date().toISOString(),
        externalReservationId,
      });
      expect(checkinRes.status).toBe(200);
      const attended = await prisma.booking.findUniqueOrThrow({ where: { id: res1.body.bookingId } });
      expect(attended.status).toBe(BookingStatus.ATTENDED);

      const reportRes = await as(ownerToken).get('/partners/reports/visits');
      expect(reportRes.status).toBe(200);
      const row = reportRes.body.find((r: any) => r.connectionLabel === 'lifecycle');
      expect(row).toBeDefined();
      expect(row.visits).toBeGreaterThanOrEqual(1);
      expect(row.expectedPayout).toMatch(/^\d+\.\d{2}$/);
    });

    it('partner cancellation follows the partner policy flag, not the studio cancellation policy', async () => {
      const connection = await makeConnection('cancel-flow', 3);
      const schedule = await makeSchedule(5);
      const externalReservationId = `res_${randomUUID()}`;
      const create = await sendWebhook(connection.id, 'whsec_cancel-flow', {
        eventId: randomUUID(),
        eventType: 'RESERVATION_CREATED',
        timestamp: new Date().toISOString(),
        externalReservationId,
        scheduleId: schedule.id,
        guest: { fullName: 'Partner Misafiri Iki' },
      });
      expect(create.status).toBe(200);
      bookingIds.push(create.body.bookingId);
      const created = await prisma.booking.findUniqueOrThrow({ where: { id: create.body.bookingId } });
      if (created.partnerGuestId) partnerGuestIds.push(created.partnerGuestId);
      const membership = await prisma.memberProfile
        .findUniqueOrThrow({ where: { id: created.memberId } })
        .then((m) => prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId } }));
      placeholderUserIds.push(membership.userId);

      const cancel = await sendWebhook(connection.id, 'whsec_cancel-flow', {
        eventId: randomUUID(),
        eventType: 'RESERVATION_CANCELLED',
        timestamp: new Date().toISOString(),
        externalReservationId,
        cancelledWithinPartnerPolicy: true,
      });
      expect(cancel.status).toBe(200);
      const cancelled = await prisma.booking.findUniqueOrThrow({ where: { id: create.body.bookingId } });
      expect(cancelled.status).toBe(BookingStatus.CANCELLED_EARLY);
      expect(cancelled.partnerCancelled).toBe(true);
      expect(cancelled.isLateCancellation).toBe(false);

      const scheduleAfter = await prisma.sessionSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      expect(scheduleAfter.bookedCount).toBe(0);
    });

    it('respects session capacity and partner quota under concurrent webhook calls', async () => {
      const connection = await makeConnection('concurrency', 1); // quota: only 1 partner spot
      const schedule = await makeSchedule(1); // capacity: only 1 seat total

      const makeBody = (suffix: string) => ({
        eventId: randomUUID(),
        eventType: 'RESERVATION_CREATED' as const,
        timestamp: new Date().toISOString(),
        externalReservationId: `res_conc_${suffix}_${randomUUID()}`,
        scheduleId: schedule.id,
        guest: { fullName: `Concurrent Guest ${suffix}` },
      });
      const bodyA = makeBody('a');
      const bodyB = makeBody('b');

      const [resA, resB] = await Promise.all([
        sendWebhook(connection.id, 'whsec_concurrency', bodyA),
        sendWebhook(connection.id, 'whsec_concurrency', bodyB),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);
      const winner = resA.status === 200 ? resA : resB;
      bookingIds.push(winner.body.bookingId);
      const winnerBooking = await prisma.booking.findUniqueOrThrow({ where: { id: winner.body.bookingId } });
      if (winnerBooking.partnerGuestId) partnerGuestIds.push(winnerBooking.partnerGuestId);
      const membership = await prisma.memberProfile
        .findUniqueOrThrow({ where: { id: winnerBooking.memberId } })
        .then((m) => prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId } }));
      placeholderUserIds.push(membership.userId);

      const scheduleAfter = await prisma.sessionSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      expect(scheduleAfter.bookedCount).toBe(1);
      const allocation = await prisma.partnerSpotAllocation.findUniqueOrThrow({
        where: { connectionId_scheduleId: { connectionId: connection.id, scheduleId: schedule.id } },
      });
      expect(allocation.usedSpots).toBe(1);
      expect(allocation.reservedSpots).toBe(1);
    });
  });
});
