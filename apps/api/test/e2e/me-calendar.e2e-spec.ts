import { createHash } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * "Hesabım" upcoming bookings / summary widgets and the personal ICS
 * calendar feed. Uses seeded demo users; creates its own schedules and
 * bookings (deterministic, cleaned up in afterAll) rather than relying on
 * seed data whose dates may have rolled into the past.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const MEMBER_PHONE = '+905321000016';
const OWNER_PHONE = '+905321000002';

describe('Me bookings, summary and calendar feed e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;
  let memberToken: string;
  let ownerToken: string;

  let studioId: string;
  let memberUserId: string;
  let memberProfileId: string;
  let otherMemberProfileId: string;

  const createdScheduleIds: string[] = [];
  const createdBookingIds: string[] = [];
  const createdOtherBookingIds: string[] = [];
  const createdSchedules: { upcomingStart: Date } = { upcomingStart: new Date() };

  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    memberToken = await login(MEMBER_PHONE);
    ownerToken = await login(OWNER_PHONE);

    const memberUser = await prisma.user.findUniqueOrThrow({ where: { phone: MEMBER_PHONE } });
    memberUserId = memberUser.id;

    const memberProfile = await prisma.memberProfile.findFirstOrThrow({
      where: { membership: { userId: memberUserId } },
    });
    memberProfileId = memberProfile.id;
    studioId = memberProfile.studioId;

    // A different member in the same studio, to prove cross-user isolation.
    const otherMemberProfile = await prisma.memberProfile.findFirstOrThrow({
      where: { studioId, id: { not: memberProfileId } },
    });
    otherMemberProfileId = otherMemberProfile.id;

    const serviceType = await prisma.serviceType.findFirstOrThrow({ where: { studioId } });
    const branch = await prisma.branch.findFirst({ where: { studioId } });

    const futureStart = new Date(Date.now() + 48 * 3600_000);
    const futureEnd = new Date(futureStart.getTime() + 3600_000);
    createdSchedules.upcomingStart = futureStart;
    const pastStart = new Date(Date.now() - 5 * 24 * 3600_000);
    const pastEnd = new Date(pastStart.getTime() + 3600_000);

    const upcomingSchedule = await prisma.sessionSchedule.create({
      data: {
        studioId,
        serviceTypeId: serviceType.id,
        branchId: branch?.id,
        title: 'E2E Upcoming',
        startTime: futureStart,
        endTime: futureEnd,
        capacity: 5,
      },
    });
    const pastSchedule = await prisma.sessionSchedule.create({
      data: {
        studioId,
        serviceTypeId: serviceType.id,
        title: 'E2E Past Cancelled',
        startTime: pastStart,
        endTime: pastEnd,
        capacity: 5,
      },
    });
    createdScheduleIds.push(upcomingSchedule.id, pastSchedule.id);

    const upcomingBooking = await prisma.booking.create({
      data: { studioId, scheduleId: upcomingSchedule.id, memberId: memberProfileId, status: 'CONFIRMED' },
    });
    const pastCancelledBooking = await prisma.booking.create({
      data: {
        studioId,
        scheduleId: pastSchedule.id,
        memberId: memberProfileId,
        status: 'CANCELLED_LATE',
        cancelledAt: new Date(),
        isLateCancellation: true,
      },
    });
    createdBookingIds.push(upcomingBooking.id, pastCancelledBooking.id);

    // Another member's booking on the same upcoming schedule: must never
    // leak into the first member's results.
    const otherSchedule = await prisma.sessionSchedule.create({
      data: {
        studioId,
        serviceTypeId: serviceType.id,
        title: 'E2E Other Member',
        startTime: futureStart,
        endTime: futureEnd,
        capacity: 5,
      },
    });
    createdScheduleIds.push(otherSchedule.id);
    const otherBooking = await prisma.booking.create({
      data: { studioId, scheduleId: otherSchedule.id, memberId: otherMemberProfileId, status: 'CONFIRMED' },
    });
    createdOtherBookingIds.push(otherBooking.id);
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: [...createdBookingIds, ...createdOtherBookingIds] } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: createdScheduleIds } } });
    await prisma.calendarFeedToken.deleteMany({ where: { userId: memberUserId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /me/bookings/upcoming', () => {
    it('requires authentication', async () => {
      expect((await request(server).get('/me/bookings/upcoming')).status).toBe(401);
    });

    it('returns only the caller own upcoming confirmed bookings', async () => {
      const res = await request(server).get('/me/bookings/upcoming').set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.items.map((i: { bookingId: string }) => i.bookingId);
      expect(ids).toContain(createdBookingIds[0]);
      // Past and cancelled bookings are excluded from "upcoming".
      expect(ids).not.toContain(createdBookingIds[1]);
      // Another member's booking never appears.
      expect(ids).not.toContain(createdOtherBookingIds[0]);

      const item = res.body.items.find((i: { bookingId: string }) => i.bookingId === createdBookingIds[0]);
      expect(item).toMatchObject({ studioId, serviceName: expect.any(String) });
    });
  });

  describe('GET /me/summary', () => {
    it('requires authentication', async () => {
      expect((await request(server).get('/me/summary')).status).toBe(401);
    });

    it('includes a next booking no later than the one this suite created for the studio', async () => {
      // The member may already have other upcoming (seeded) bookings, so the
      // "next" one is not necessarily ours; assert it is at least as soon.
      const res = await request(server).get('/me/summary').set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(200);
      expect(res.body.nextBooking).not.toBeNull();
      const studioEntry = res.body.studios.find((s: { studioId: string }) => s.studioId === studioId);
      expect(studioEntry?.nextBooking).not.toBeNull();
      expect(new Date(studioEntry.nextBooking.startTime).getTime()).toBeLessThanOrEqual(
        new Date(createdSchedules.upcomingStart).getTime(),
      );
      // Another member's booking never appears as anyone else's next booking here.
      expect(studioEntry?.nextBooking?.bookingId).not.toBe(createdOtherBookingIds[0]);
    });
  });

  describe('calendar feed lifecycle', () => {
    let rawToken: string;

    it('POST /me/calendar-feed creates a token and returns it once', async () => {
      const res = await request(server).post('/me/calendar-feed').set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(201);
      expect(res.body.url).toMatch(/\/calendar\/[a-f0-9]{64}\.ics$/);
      expect(res.body.webcalUrl.startsWith('webcal://')).toBe(true);
      rawToken = res.body.url.split('/calendar/')[1].replace('.ics', '');

      const stored = await prisma.calendarFeedToken.findUniqueOrThrow({ where: { userId: memberUserId } });
      expect(stored.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    });

    it('GET /calendar/:token.ics serves the caller own bookings only', async () => {
      const res = await request(server).get(`/calendar/${rawToken}.ics`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect(res.text).toContain(`UID:booking-${createdBookingIds[0]}@platform`);
      expect(res.text).toContain('STATUS:CONFIRMED');
      // Last-30-days cancelled booking is included, marked cancelled.
      expect(res.text).toContain(`UID:booking-${createdBookingIds[1]}@platform`);
      expect(res.text).toContain('STATUS:CANCELLED');
      // Never another member's booking.
      expect(res.text).not.toContain(createdOtherBookingIds[0]);
    });

    it('rotating replaces the token and invalidates the old URL', async () => {
      const rotateRes = await request(server).post('/me/calendar-feed').set('Authorization', `Bearer ${memberToken}`);
      expect(rotateRes.status).toBe(201);
      const newToken = rotateRes.body.url.split('/calendar/')[1].replace('.ics', '');
      expect(newToken).not.toBe(rawToken);

      const oldUrlRes = await request(server).get(`/calendar/${rawToken}.ics`);
      expect(oldUrlRes.status).toBe(404);

      const newUrlRes = await request(server).get(`/calendar/${newToken}.ics`);
      expect(newUrlRes.status).toBe(200);
      rawToken = newToken;
    });

    it('unknown or malformed tokens return 404, not a distinguishable error', async () => {
      const unknown = await request(server).get(`/calendar/${'0'.repeat(64)}.ics`);
      expect(unknown.status).toBe(404);
      const malformed = await request(server).get('/calendar/not-a-token.ics');
      expect(malformed.status).toBe(404);
    });

    it('DELETE /me/calendar-feed revokes the feed', async () => {
      const del = await request(server).delete('/me/calendar-feed').set('Authorization', `Bearer ${memberToken}`);
      expect(del.status).toBe(204);

      const afterRevoke = await request(server).get(`/calendar/${rawToken}.ics`);
      expect(afterRevoke.status).toBe(404);

      expect(await prisma.calendarFeedToken.findUnique({ where: { userId: memberUserId } })).toBeNull();
    });

    it('another user cannot see this member bookings through their own feed', async () => {
      const ownerFeed = await request(server).post('/me/calendar-feed').set('Authorization', `Bearer ${ownerToken}`);
      expect(ownerFeed.status).toBe(201);
      const ownerToken2 = ownerFeed.body.url.split('/calendar/')[1].replace('.ics', '');

      const res = await request(server).get(`/calendar/${ownerToken2}.ics`);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(createdBookingIds[0]);

      const ownerUserId = (await prisma.user.findUniqueOrThrow({ where: { phone: OWNER_PHONE } })).id;
      await prisma.calendarFeedToken.deleteMany({ where: { userId: ownerUserId } });
    });
  });
});
