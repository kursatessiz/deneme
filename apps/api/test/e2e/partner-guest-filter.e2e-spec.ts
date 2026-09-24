import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { createHmac, randomUUID } from 'crypto';
import { PrismaClient, BookingStatus } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { WinBackEvaluator } from '../../src/modules/automations/evaluators/win-back.evaluator';
import { ChurnService } from '../../src/modules/churn/churn.service';

/**
 * Owner decision: partner (aggregator) guests must not be treated as
 * regular members for messaging and engagement until they join the studio
 * themselves. Covers Membership.isPartnerGuest end to end: a partner
 * webhook flags a new guest membership, automation targeting and churn
 * scoring skip flagged memberships, a phone already belonging to a real
 * member is left unflagged even when a partner reports it, and staff
 * creating a member (or converting a lead) for an already-flagged phone
 * clears the flag on the existing membership instead of creating a
 * duplicate. Builds its own connection and session schedules so it never
 * depends on (or alters) seed data, and removes everything it created.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const HOUR = 3600_000;

function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

describe('Partner guest filtering (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;
  let moduleRef: TestingModule;

  let ZEN: string;
  let ownerToken: string;
  let serviceTypeId: string;

  const connectionIds: string[] = [];
  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];
  const partnerGuestIds: string[] = [];
  const userIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string, body?: unknown) =>
      request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId).send(body ?? {}),
  });

  const makeConnection = async (label: string) => {
    const res = await as(ownerToken).post('/partners/connections', {
      provider: 'MOCK',
      label,
      credentials: { webhookSecret: `whsec_${label}`, apiKey: 'k' },
      config: { spotsPerSession: 5, payoutRatePerVisit: '0.00', releaseHoursBeforeStart: 1 },
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
        title: 'E2E partner-guest-filter session',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity,
      },
    });
    scheduleIds.push(s.id);
    return s;
  };

  const sendWebhook = (connectionId: string, secret: string, body: Record<string, unknown>) => {
    const rawBody = JSON.stringify(body);
    const timestamp = new Date().toISOString();
    const signature = signWebhook(secret, timestamp, rawBody);
    return request(server)
      .post(`/partners/mock/webhook/${connectionId}`)
      .set('x-partner-signature', signature)
      .set('x-partner-timestamp', timestamp)
      .send(body);
  };

  /** Books a partner guest via webhook and returns the resulting membership row. */
  const createGuestBooking = async (connectionId: string, secret: string, scheduleId: string, guest: { fullName: string; phone?: string }) => {
    const res = await sendWebhook(connectionId, secret, {
      eventId: randomUUID(),
      eventType: 'RESERVATION_CREATED',
      timestamp: new Date().toISOString(),
      externalReservationId: `res_${randomUUID()}`,
      scheduleId,
      guest,
    });
    expect(res.status).toBe(200);
    bookingIds.push(res.body.bookingId);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
    if (booking.partnerGuestId) partnerGuestIds.push(booking.partnerGuestId);
    const memberProfile = await prisma.memberProfile.findUniqueOrThrow({ where: { id: booking.memberId } });
    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: memberProfile.membershipId } });
    userIds.push(membership.userId);
    return { booking, memberProfile, membership };
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN } })).id;

    ownerToken = await login(OWNER_PHONE);
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.partnerGuest.deleteMany({ where: { id: { in: partnerGuestIds } } });
    await prisma.partnerSpotAllocation.deleteMany({ where: { connectionId: { in: connectionIds } } });
    await prisma.partnerWebhookEvent.deleteMany({ where: { connectionId: { in: connectionIds } } });
    await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.memberProfile.deleteMany({ where: { membership: { userId: { in: userIds } } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.partnerConnection.deleteMany({ where: { id: { in: connectionIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.auditLog.deleteMany({ where: { studioId: ZEN, entityType: { in: ['PartnerConnection', 'Booking'] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('flags a brand-new partner guest membership as isPartnerGuest', async () => {
    const connection = await makeConnection('guest-flag');
    const schedule = await makeSchedule(5);
    const { membership } = await createGuestBooking(connection.id, 'whsec_guest-flag', schedule.id, {
      fullName: 'Partner Misafiri Flag',
      phone: '+905550009001',
    });
    expect(membership.isPartnerGuest).toBe(true);
  });

  it('leaves an existing real membership unflagged when a partner reports the same phone', async () => {
    // Staff creates a real member first.
    const phone = '+905550009002';
    const createRes = await as(ownerToken).post('/members', {
      studioId: ZEN,
      firstName: 'Gercek',
      lastName: 'Uye',
      phone,
    });
    expect(createRes.status).toBe(201);
    const membershipIdBefore = createRes.body.membershipId as string;
    const membershipBefore = await prisma.membership.findUniqueOrThrow({ where: { id: membershipIdBefore } });
    expect(membershipBefore.isPartnerGuest).toBe(false);
    userIds.push(membershipBefore.userId);

    const connection = await makeConnection('existing-member');
    const schedule = await makeSchedule(5);
    const { membership } = await createGuestBooking(connection.id, 'whsec_existing-member', schedule.id, {
      fullName: 'Gercek Uye',
      phone,
    });

    expect(membership.id).toBe(membershipIdBefore);
    expect(membership.isPartnerGuest).toBe(false);
  });

  it('excludes a flagged partner guest from automation rule targeting (WIN_BACK)', async () => {
    const connection = await makeConnection('automation-skip');
    const schedule = await makeSchedule(5);
    const { membership } = await createGuestBooking(connection.id, 'whsec_automation-skip', schedule.id, {
      fullName: 'Otomasyon Disi Misafir',
      phone: '+905550009003',
    });
    expect(membership.isPartnerGuest).toBe(true);

    const evaluator = moduleRef.get(WinBackEvaluator);
    const candidates = await evaluator.findCandidates(
      ZEN,
      { type: 'WIN_BACK', noAttendanceDays: 1, requireNoActivePackage: false },
      new Date(),
    );
    expect(candidates.some((c) => c.userId === membership.userId)).toBe(false);
  });

  it('excludes a flagged partner guest from churn recompute', async () => {
    const connection = await makeConnection('churn-skip');
    const schedule = await makeSchedule(5);
    const { membership, memberProfile } = await createGuestBooking(connection.id, 'whsec_churn-skip', schedule.id, {
      fullName: 'Churn Disi Misafir',
      phone: '+905550009004',
    });
    expect(membership.isPartnerGuest).toBe(true);

    const churn = moduleRef.get(ChurnService);
    await churn.recomputeStudio(ZEN, new Date());

    const snapshot = await prisma.memberRiskSnapshot.findUnique({ where: { memberId: memberProfile.id } });
    expect(snapshot).toBeNull();
  });

  it('staff createMember for a flagged guest phone clears the flag and reuses the membership (no duplicate)', async () => {
    const connection = await makeConnection('promote');
    const schedule = await makeSchedule(5);
    const phone = '+905550009005';
    const { membership: guestMembership } = await createGuestBooking(connection.id, 'whsec_promote', schedule.id, {
      fullName: 'Terfi Eden Misafir',
      phone,
    });
    expect(guestMembership.isPartnerGuest).toBe(true);

    const res = await as(ownerToken).post('/members', {
      studioId: ZEN,
      firstName: 'Terfi',
      lastName: 'Eden',
      phone,
    });
    expect(res.status).toBe(201);
    expect(res.body.isPartnerGuest).toBe(false);
    expect(res.body.membershipId).toBe(guestMembership.id);

    const memberships = await prisma.membership.findMany({ where: { studioId: ZEN, userId: guestMembership.userId } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].isPartnerGuest).toBe(false);
  });
});
