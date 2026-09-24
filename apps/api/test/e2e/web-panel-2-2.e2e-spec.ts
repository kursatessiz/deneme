import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * Web panel backlog 2.2: the two endpoints added for the calendar and
 * member-card screens -- moving/editing a session (drag-drop calls this
 * with only startTime/endTime) and ending a package freeze early.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe('Web panel 2.2: schedule update, package unfreeze (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let ownerToken: string;
  let trainerToken: string;

  let serviceTypeId: string;
  let trainerA: string;
  let trainerB: string;
  let memberId: string;
  let packageDefinitionId: string;

  const scheduleIds: string[] = [];
  const packageIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string) => ({
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
  });

  const makeSchedule = async (startInHours: number, trainerId?: string) => {
    const start = new Date(Date.now() + startInHours * HOUR);
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        serviceTypeId,
        trainerId,
        title: 'E2E 2.2 seans',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity: 2,
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
    ownerToken = await login('+905321000002');
    trainerToken = await login('+905321000004');

    const suffix = Date.now().toString(36);
    const serviceType = await prisma.serviceType.create({
      data: { studioId: ZEN, name: `E2E 2.2 hizmet ${suffix}`, durationMin: 60, capacity: 2 },
    });
    serviceTypeId = serviceType.id;

    const trainers = await prisma.trainerProfile.findMany({
      where: { studioId: ZEN, membership: { status: 'ACTIVE' } },
      take: 2,
      orderBy: { id: 'asc' },
    });
    expect(trainers).toHaveLength(2);
    trainerA = trainers[0].id;
    trainerB = trainers[1].id;

    memberId = (
      await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: '+905321000016' } } } })
    ).id;

    const def = await prisma.packageDefinition.create({
      data: {
        studioId: ZEN,
        name: `E2E 2.2 paket ${suffix}`,
        entitlementKind: 'SESSION_COUNT',
        totalUnits: 5,
        validityDays: 30,
        freezeDaysAllowed: 15,
        price: 0,
      },
    });
    packageDefinitionId = def.id;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: scheduleIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.packageFreezeHistory.deleteMany({ where: { memberPackageId: { in: packageIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.packageDefinition.deleteMany({ where: { id: packageDefinitionId } });
    await prisma.serviceType.deleteMany({ where: { id: serviceTypeId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('PATCH /schedules/:scheduleId', () => {
    it('trainer role cannot move a session', async () => {
      const scheduleId = await makeSchedule(24, trainerA);
      const res = await as(trainerToken).patch(`/schedules/${scheduleId}`).send({ startTime: new Date(Date.now() + 30 * HOUR).toISOString() });
      expect(res.status).toBe(403);
    });

    it('moves a session to a new time (drag-drop shape: only start/end)', async () => {
      const scheduleId = await makeSchedule(24, trainerA);
      const newStart = new Date(Date.now() + 30 * HOUR);
      const newEnd = new Date(newStart.getTime() + HOUR);
      const res = await as(ownerToken)
        .patch(`/schedules/${scheduleId}`)
        .send({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() });
      expect(res.status).toBe(200);
      expect(new Date(res.body.startTime).getTime()).toBe(newStart.getTime());
      expect(new Date(res.body.endTime).getTime()).toBe(newEnd.getTime());
    });

    it('rejects a move that conflicts with the trainer\'s other session', async () => {
      const busyStart = new Date(Date.now() + 40 * HOUR);
      await makeSchedule(40, trainerB);
      const scheduleId = await makeSchedule(24, trainerB);
      const res = await as(ownerToken)
        .patch(`/schedules/${scheduleId}`)
        .send({ startTime: busyStart.toISOString(), endTime: new Date(busyStart.getTime() + HOUR).toISOString() });
      expect(res.status).toBe(409);
    });

    it('edits trainer and title without moving the time', async () => {
      const scheduleId = await makeSchedule(50, trainerA);
      const res = await as(ownerToken).patch(`/schedules/${scheduleId}`).send({ trainerId: trainerB, title: 'Guncellenmis seans' });
      expect(res.status).toBe(200);
      expect(res.body.trainerId).toBe(trainerB);
      expect(res.body.title).toBe('Guncellenmis seans');
    });

    it('refuses to lower capacity below the seats already booked', async () => {
      const scheduleId = await makeSchedule(24, trainerA);
      await prisma.booking.create({ data: { studioId: ZEN, scheduleId, memberId, status: 'CONFIRMED', unitsCharged: 0 } });
      const res = await as(ownerToken).patch(`/schedules/${scheduleId}`).send({ capacity: 0 });
      expect(res.status).toBe(400);
    });

    it('refuses to move a booked session into the past', async () => {
      const scheduleId = await makeSchedule(24, trainerA);
      await prisma.booking.create({ data: { studioId: ZEN, scheduleId, memberId, status: 'CONFIRMED', unitsCharged: 0 } });
      const pastStart = new Date(Date.now() - 2 * HOUR);
      const res = await as(ownerToken)
        .patch(`/schedules/${scheduleId}`)
        .send({ startTime: pastStart.toISOString(), endTime: new Date(pastStart.getTime() + HOUR).toISOString() });
      expect(res.status).toBe(400);
    });

    it('404 for a session in another studio', async () => {
      const res = await as(ownerToken)
        .patch('/schedules/00000000-0000-4000-8000-000000000000')
        .send({ title: 'Guncellenmis seans yok' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /members/packages/:packageId/unfreeze', () => {
    const makePackage = async () => {
      const p = await prisma.memberPackage.create({
        data: {
          studioId: ZEN,
          memberId,
          packageDefinitionId,
          entitlementKind: 'SESSION_COUNT',
          totalUnits: 5,
          remainingUnits: 5,
          endDate: new Date(Date.now() + 30 * DAY),
        },
      });
      packageIds.push(p.id);
      return p.id;
    };

    it('cannot unfreeze a package that is not frozen', async () => {
      const packageId = await makePackage();
      const res = await as(ownerToken).post(`/members/packages/${packageId}/unfreeze`).send({ studioId: ZEN });
      expect(res.status).toBe(400);
    });

    it('unfreezes an active freeze, shortening endDate by the unused days', async () => {
      const packageId = await makePackage();
      const freeze = await as(ownerToken).post(`/members/packages/${packageId}/freeze`).send({ studioId: ZEN, days: 10 });
      expect(freeze.status).toBe(201);
      const frozenEndDate = new Date(freeze.body.endDate).getTime();

      const res = await as(ownerToken).post(`/members/packages/${packageId}/unfreeze`).send({ studioId: ZEN });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.frozenUntil).toBeNull();
      expect(new Date(res.body.endDate).getTime()).toBeLessThan(frozenEndDate);
    });

    it('trainer role cannot unfreeze', async () => {
      const packageId = await makePackage();
      await as(ownerToken).post(`/members/packages/${packageId}/freeze`).send({ studioId: ZEN, days: 5 });
      const res = await as(trainerToken).post(`/members/packages/${packageId}/unfreeze`).send({ studioId: ZEN });
      expect(res.status).toBe(403);
    });
  });
});
