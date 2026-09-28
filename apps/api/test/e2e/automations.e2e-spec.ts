import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W10 automation rules after G2a: the deprecated /automation-rules wrapper
 * over journeys (CRUD shapes, validation, permissions, tenant isolation,
 * dry-run preview) and the migration of a stored legacy rule into a
 * journey without sending a message the old runner already sent. Builds its
 * own service type, schedule and bookings and removes everything it
 * created afterwards.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3_600_000;

// 12:00 Europe/Istanbul today: bookings and scheduler runs use this instant.
const SCHED_NOW = new Date(Date.now());
SCHED_NOW.setUTCHours(9, 0, 0, 0);

describe('Automation rules wrapper and legacy migration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;
  let superAdminToken: string;

  let serviceTypeId: string;
  let memberUserId: string;
  let memberProfileId: string;
  let seededReminderIds: string[] = [];

  const journeyIds: string[] = [];
  const ruleIds: string[] = [];
  const scheduleIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const runScheduler = (now: Date) =>
    request(server).post('/admin/scheduler/run').set('Authorization', `Bearer ${superAdminToken}`).send({ now: now.toISOString() });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    ownerToken = await login('+905321000002');
    trainerToken = await login('+905321000004');
    memberToken = await login('+905321000016');
    superAdminToken = await login('+905321000001');

    const suffix = Date.now().toString(36);
    serviceTypeId = (await prisma.serviceType.create({ data: { studioId: ZEN, name: `Otomasyon hizmet ${suffix}`, durationMin: 60, capacity: 4 } })).id;
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { phone: '+905321000016' } });
    memberUserId = memberUser.id;
    memberProfileId = (await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { userId: memberUserId } } })).id;

    // BOOKING_REMINDER defaults to push only; allow SMS so a reminder reaches a channel.
    await prisma.notificationPreference.upsert({
      where: { userId_category: { userId: memberUserId, category: 'BOOKING_REMINDER' } },
      create: { userId: memberUserId, category: 'BOOKING_REMINDER', push: true, sms: true },
      update: { sms: true },
    });

    // The seeded reminder journey would also remind these bookings; pause it so
    // the assertions below see only the migrated rule's journey.
    const seeded = await prisma.journey.findMany({ where: { studioId: ZEN, legacyRuleType: 'BOOKING_REMINDER', legacyRuleId: null, status: 'ACTIVE' } });
    seededReminderIds = seeded.map((j) => j.id);
    await prisma.journey.updateMany({ where: { id: { in: seededReminderIds } }, data: { status: 'PAUSED' } });
  });

  afterAll(async () => {
    await prisma.journey.updateMany({ where: { id: { in: seededReminderIds } }, data: { status: 'ACTIVE' } });
    const scheduleBookings = await prisma.booking.findMany({ where: { scheduleId: { in: scheduleIds } }, select: { id: true } });
    await prisma.journeyEnrollment.deleteMany({ where: { triggerRef: { in: scheduleBookings.map((b) => b.id) } } });
    const migrated = await prisma.journey.findMany({ where: { legacyRuleId: { in: ruleIds } }, select: { id: true, definition: true } });
    await prisma.automationRule.deleteMany({ where: { id: { in: ruleIds } } });
    const allJourneys = [...journeyIds, ...migrated.map((j) => j.id)];
    const segments = (await prisma.journey.findMany({ where: { id: { in: allJourneys } }, select: { definition: true } }))
      .map((j) => (j.definition as { trigger?: { segmentId?: string } }).trigger?.segmentId)
      .filter((id): id is string => Boolean(id));
    await prisma.journey.deleteMany({ where: { id: { in: allJourneys } } });
    await prisma.segment.deleteMany({ where: { id: { in: segments } } });
    await prisma.notificationLog.deleteMany({ where: { studioId: ZEN, type: 'BOOKING_REMINDER', recipientPhone: '+905321000016', createdAt: { gte: new Date(Date.now() - HOUR) } } });
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.serviceType.deleteMany({ where: { id: serviceTypeId } });
    await prisma.notificationPreference.deleteMany({ where: { userId: memberUserId, category: 'BOOKING_REMINDER' } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('deprecated wrapper', () => {
    it('creates, reads, updates and toggles a rule backed by a journey', async () => {
      const create = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'PACKAGE_EXPIRING',
        name: 'E2E paket bitişi',
        templateKey: 'PACKAGE_EXPIRING',
        params: { type: 'PACKAGE_EXPIRING', daysBefore: 5 },
        isActive: false,
      });
      expect(create.status).toBe(201);
      expect(create.body).toMatchObject({ isTransactional: true, isActive: false, type: 'PACKAGE_EXPIRING' });
      journeyIds.push(create.body.id);
      const journey = await prisma.journey.findUniqueOrThrow({ where: { id: create.body.id } });
      expect(journey).toMatchObject({ studioId: ZEN, legacyRuleType: 'PACKAGE_EXPIRING', status: 'PAUSED' });

      const list = await as(ownerToken, ZEN).get(`/studios/${ZEN}/automation-rules`);
      expect(list.status).toBe(200);
      expect(list.body.items.some((r: { id: string }) => r.id === create.body.id)).toBe(true);

      const update = await as(ownerToken, ZEN)
        .put(`/studios/${ZEN}/automation-rules/${create.body.id}`)
        .send({ params: { type: 'PACKAGE_EXPIRING', daysBefore: 10 } });
      expect(update.status).toBe(200);
      expect(update.body.params.daysBefore).toBe(10);

      const toggle = await as(ownerToken, ZEN).patch(`/studios/${ZEN}/automation-rules/${create.body.id}/toggle`).send({ isActive: true });
      expect(toggle.status).toBe(200);
      expect(toggle.body.isActive).toBe(true);
      expect((await prisma.journey.findUniqueOrThrow({ where: { id: create.body.id } })).status).toBe('ACTIVE');
      await as(ownerToken, ZEN).patch(`/studios/${ZEN}/automation-rules/${create.body.id}/toggle`).send({ isActive: false });

      const preview = await as(ownerToken, ZEN).get(`/studios/${ZEN}/automation-rules/${create.body.id}/preview`);
      expect(preview.status).toBe(200);
      expect(typeof preview.body.count).toBe('number');
      expect(await prisma.journeyEnrollment.count({ where: { journeyId: create.body.id } })).toBe(0);
    });

    it('WIN_BACK is marketing and gets its own audience segment', async () => {
      const create = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'WIN_BACK',
        name: 'E2E kayıp üye',
        templateKey: 'WIN_BACK',
        params: { type: 'WIN_BACK', noAttendanceDays: 45 },
      });
      expect(create.status).toBe(201);
      journeyIds.push(create.body.id);
      expect(create.body).toMatchObject({ isTransactional: false, params: { type: 'WIN_BACK', noAttendanceDays: 45, requireNoActivePackage: true } });
    });

    it('rejects invalid params', async () => {
      const noThreshold = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'PACKAGE_EXPIRING',
        name: 'Geçersiz',
        templateKey: 'PACKAGE_EXPIRING',
        params: { type: 'PACKAGE_EXPIRING' },
      });
      expect(noThreshold.status).toBe(400);
      const mismatch = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'BIRTHDAY',
        name: 'Geçersiz',
        templateKey: 'BIRTHDAY',
        params: { type: 'WIN_BACK', noAttendanceDays: 10 },
      });
      expect(mismatch.status).toBe(400);
    });

    it('keeps the permission and tenant rules', async () => {
      for (const token of [trainerToken, memberToken]) {
        expect((await as(token, ZEN).get(`/studios/${ZEN}/automation-rules`)).status).toBe(403);
      }
      expect((await as(ownerToken, FLOW).get(`/studios/${FLOW}/automation-rules`)).status).toBe(403);
      const flowList = await as(superAdminToken, FLOW).get(`/studios/${FLOW}/automation-rules`);
      expect(flowList.status).toBe(200);
      expect(flowList.body.items.every((r: { id: string }) => !journeyIds.includes(r.id))).toBe(true);
      expect((await as(superAdminToken, FLOW).get(`/studios/${FLOW}/automation-rules/${journeyIds[0]}`)).status).toBe(404);
    });
  });

  describe('legacy rule migration', () => {
    it('converts a stored rule into a journey and never repeats a reminder the old runner sent', async () => {
      const start = new Date(SCHED_NOW.getTime() + HOUR);
      const schedule = await prisma.sessionSchedule.create({
        data: { studioId: ZEN, serviceTypeId, title: 'Otomasyon taşıma dersi', startTime: start, endTime: new Date(start.getTime() + HOUR), capacity: 4 },
      });
      scheduleIds.push(schedule.id);
      const second = await prisma.sessionSchedule.create({
        data: { studioId: ZEN, serviceTypeId, title: 'Otomasyon taşıma dersi 2', startTime: new Date(start.getTime() + 30 * 60_000), endTime: new Date(start.getTime() + 90 * 60_000), capacity: 4 },
      });
      scheduleIds.push(second.id);
      const alreadySent = await prisma.booking.create({ data: { studioId: ZEN, scheduleId: schedule.id, memberId: memberProfileId, status: 'CONFIRMED' } });
      const notYetSent = await prisma.booking.create({ data: { studioId: ZEN, scheduleId: second.id, memberId: memberProfileId, status: 'CONFIRMED' } });

      // A rule exactly as the W10 runner left it: active, one reminder already delivered.
      const rule = await prisma.automationRule.create({
        data: {
          studioId: ZEN,
          type: 'BOOKING_REMINDER',
          name: 'E2E eski hatırlatma',
          params: { type: 'BOOKING_REMINDER', hoursBefore: 2 },
          templateKey: 'BOOKING_REMINDER',
          isActive: true,
          isTransactional: true,
        },
      });
      ruleIds.push(rule.id);
      await prisma.automationRun.create({
        data: { ruleId: rule.id, studioId: ZEN, userId: memberUserId, targetRef: alreadySent.id, scheduledFor: start, status: 'SENT', sentAt: SCHED_NOW },
      });

      expect((await runScheduler(SCHED_NOW)).status).toBe(201);
      expect((await runScheduler(new Date(SCHED_NOW.getTime() + 60_000))).status).toBe(201);

      const migratedRule = await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } });
      expect(migratedRule.isActive).toBe(false);
      expect(migratedRule.migratedJourneyId).toBeTruthy();
      const journey = await prisma.journey.findUniqueOrThrow({ where: { id: migratedRule.migratedJourneyId! } });
      expect(journey).toMatchObject({ status: 'ACTIVE', legacyRuleId: rule.id, legacyRuleType: 'BOOKING_REMINDER' });

      const enrollments = await prisma.journeyEnrollment.findMany({ where: { journeyId: journey.id } });
      expect(enrollments.map((e) => e.triggerRef)).toEqual([notYetSent.id]);
      expect(enrollments[0].status).toBe('COMPLETED');
      expect(await prisma.notificationLog.count({ where: { journeyRunId: enrollments[0].id, status: 'SENT' } })).toBe(1);
      // The old runner is gone: no new automation run rows appear.
      expect(await prisma.automationRun.count({ where: { ruleId: rule.id } })).toBe(1);

      // The wrapper resolves the old rule id to the journey.
      const byOldId = await as(ownerToken, ZEN).get(`/studios/${ZEN}/automation-rules/${rule.id}`);
      expect(byOldId.status).toBe(200);
      expect(byOldId.body).toMatchObject({ id: journey.id, isActive: true, params: { type: 'BOOKING_REMINDER', hoursBefore: 2 } });
    });
  });
});
