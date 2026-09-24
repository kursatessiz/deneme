import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * Backlog 1.4: cancellation policy engine, no-show, waitlist auto-promotion
 * and trainer substitution against a real database. The suite builds its own
 * service type, policy and packages so it never depends on (or alters) the
 * seed's catalogue, and removes everything it created afterwards.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;

describe('Schedules: policy, waitlist, substitution (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let serviceTypeId: string;
  let policyId: string;
  let packageDefinitionId: string;
  let selfMemberId: string;
  let otherMembers: string[];
  let trainers: string[];
  let flowTrainerId: string;

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
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
  });

  const makeSchedule = async (startInHours: number, capacity: number, trainerId?: string) => {
    const start = new Date(Date.now() + startInHours * HOUR);
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        serviceTypeId,
        trainerId,
        title: 'E2E politika',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity,
      },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  const makePackage = async (memberId: string, units: number) => {
    const p = await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId,
        packageDefinitionId,
        entitlementKind: 'CREDIT',
        totalUnits: units,
        remainingUnits: units,
        endDate: new Date(Date.now() + 30 * 24 * HOUR),
      },
    });
    packageIds.push(p.id);
    return p.id;
  };

  const book = (memberId: string, scheduleId: string, memberPackageId: string) =>
    as(ownerToken).post('/schedules/book').send({ studioId: ZEN, scheduleId, memberId, memberPackageId });

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

    const suffix = Date.now().toString(36);
    const policy = await prisma.cancellationPolicy.create({
      data: { studioId: ZEN, name: `E2E 12s ${suffix}`, freeCancelHours: 12, lateCancelChargeUnits: 1, noShowChargeUnits: 1 },
    });
    policyId = policy.id;
    const serviceType = await prisma.serviceType.create({
      data: { studioId: ZEN, name: `E2E hizmet ${suffix}`, durationMin: 60, capacity: 1, cancellationPolicyId: policyId },
    });
    serviceTypeId = serviceType.id;
    const def = await prisma.packageDefinition.create({
      data: {
        studioId: ZEN,
        name: `E2E kredi ${suffix}`,
        entitlementKind: 'CREDIT',
        totalUnits: 10,
        validityDays: 30,
        price: 0,
        services: { create: { serviceTypeId, unitCost: 2 } },
      },
    });
    packageDefinitionId = def.id;

    const self = await prisma.memberProfile.findFirstOrThrow({
      where: { studioId: ZEN, membership: { user: { phone: '+905321000016' } } },
    });
    selfMemberId = self.id;
    otherMembers = (
      await prisma.memberProfile.findMany({ where: { studioId: ZEN, id: { not: selfMemberId } }, take: 3, orderBy: { id: 'asc' } })
    ).map((m) => m.id);
    expect(otherMembers).toHaveLength(3);

    trainers = (
      await prisma.trainerProfile.findMany({
        where: { studioId: ZEN, membership: { status: 'ACTIVE' } },
        take: 2,
        orderBy: { id: 'asc' },
      })
    ).map((t) => t.id);
    expect(trainers).toHaveLength(2);
    flowTrainerId = (await prisma.trainerProfile.findFirstOrThrow({ where: { studioId: FLOW } })).id;
  });

  afterAll(async () => {
    await prisma.waitlist.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.bookingResource.deleteMany({ where: { booking: { scheduleId: { in: scheduleIds } } } });
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: scheduleIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.packageDefinition.deleteMany({ where: { id: packageDefinitionId } });
    await prisma.serviceType.deleteMany({ where: { id: serviceTypeId } });
    await prisma.cancellationPolicy.deleteMany({ where: { id: policyId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('waitlist auto-promotion', () => {
    let scheduleId: string;
    let pkgA: string;
    let pkgB: string;
    let pkgSelf: string;
    let waitSelfId: string;

    beforeAll(async () => {
      scheduleId = await makeSchedule(48, 1);
      pkgA = await makePackage(otherMembers[0], 4);
      pkgB = await makePackage(otherMembers[1], 2);
      pkgSelf = await makePackage(selfMemberId, 2);
    });

    it('cannot join the waitlist while seats are free', async () => {
      const res = await as(ownerToken)
        .post('/schedules/waitlist')
        .send({ studioId: ZEN, scheduleId, memberId: otherMembers[1], memberPackageId: pkgB });
      expect(res.status).toBe(400);
    });

    it('fills the only seat', async () => {
      expect((await book(otherMembers[0], scheduleId, pkgA)).status).toBe(201);
    });

    it('staff and self joins get positions in order', async () => {
      const b = await as(ownerToken)
        .post('/schedules/waitlist')
        .send({ studioId: ZEN, scheduleId, memberId: otherMembers[1], memberPackageId: pkgB });
      expect(b.status).toBe(201);
      expect(b.body.placeInLine).toBe(1);

      const self = await as(memberToken)
        .post('/schedules/waitlist/self')
        .send({ studioId: ZEN, scheduleId, memberId: selfMemberId, memberPackageId: pkgSelf });
      expect(self.status).toBe(201);
      expect(self.body.placeInLine).toBe(2);
      waitSelfId = self.body.id;
    });

    it('duplicate join -> 409', async () => {
      const res = await as(ownerToken)
        .post('/schedules/waitlist')
        .send({ studioId: ZEN, scheduleId, memberId: otherMembers[1], memberPackageId: pkgB });
      expect(res.status).toBe(409);
    });

    it('member cannot join on behalf of someone else', async () => {
      const res = await as(memberToken)
        .post('/schedules/waitlist/self')
        .send({ studioId: ZEN, scheduleId, memberId: otherMembers[2] });
      expect(res.status).toBe(403);
    });

    it('staff sees the waitlist in order', async () => {
      const res = await as(ownerToken).get(`/schedules/waitlist/${scheduleId}`);
      expect(res.status).toBe(200);
      expect(res.body.map((e: any) => e.memberId)).toEqual([otherMembers[1], selfMemberId]);
    });

    it('early cancel refunds all units and promotes the head of the line', async () => {
      const booking = await prisma.booking.findFirstOrThrow({ where: { scheduleId, memberId: otherMembers[0] } });
      const res = await as(ownerToken)
        .post('/schedules/cancel')
        .send({ bookingId: booking.id, cancelledBy: 'STUDIO' });
      expect(res.status).toBe(201);
      expect(res.body.isLateCancellation).toBe(false);
      expect(res.body.refundedUnits).toBe(2);
      expect(res.body.promotedFromWaitlist).toBe(1);

      const a = await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkgA } });
      expect(a.remainingUnits).toBe(4);

      const promoted = await prisma.booking.findFirstOrThrow({ where: { scheduleId, memberId: otherMembers[1] } });
      expect(promoted.status).toBe('CONFIRMED');
      expect(promoted.unitsCharged).toBe(2);
      const b = await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkgB } });
      expect(b.remainingUnits).toBe(0);
      expect(b.status).toBe('DEPLETED');

      const entry = await prisma.waitlist.findFirstOrThrow({ where: { scheduleId, memberId: otherMembers[1] } });
      expect(entry.status).toBe('PROMOTED');
      const schedule = await prisma.sessionSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
      expect(schedule.bookedCount).toBe(1);
    });

    it('member leaves the waitlist', async () => {
      const res = await as(memberToken).post('/schedules/waitlist/leave/self').send({ waitlistId: waitSelfId });
      expect(res.status).toBe(201);
      const again = await as(memberToken).post('/schedules/waitlist/leave/self').send({ waitlistId: waitSelfId });
      expect(again.status).toBe(400);
    });

    it('the cancelled member can rebook later (row reused)', async () => {
      const promoted = await prisma.booking.findFirstOrThrow({ where: { scheduleId, memberId: otherMembers[1] } });
      await as(ownerToken).post('/schedules/cancel').send({ bookingId: promoted.id, cancelledBy: 'STUDIO' }).expect(201);
      const res = await book(otherMembers[0], scheduleId, pkgA);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CONFIRMED');
      expect(res.body.penaltyUnits).toBe(0);
    });
  });

  describe('promotion skips an entry whose package can no longer pay', () => {
    let scheduleId: string;

    it('marks it EXPIRED with the reason and promotes the next member', async () => {
      scheduleId = await makeSchedule(50, 1);
      const pkgA = await makePackage(otherMembers[0], 2);
      const pkgB = await makePackage(otherMembers[1], 2);
      const pkgC = await makePackage(otherMembers[2], 2);
      expect((await book(otherMembers[0], scheduleId, pkgA)).status).toBe(201);
      for (const [memberId, memberPackageId] of [
        [otherMembers[1], pkgB],
        [otherMembers[2], pkgC],
      ]) {
        await as(ownerToken).post('/schedules/waitlist').send({ studioId: ZEN, scheduleId, memberId, memberPackageId }).expect(201);
      }
      // B spends the package elsewhere after joining.
      await prisma.memberPackage.update({ where: { id: pkgB }, data: { remainingUnits: 0, usedUnits: 2, status: 'DEPLETED' } });

      const booking = await prisma.booking.findFirstOrThrow({ where: { scheduleId, memberId: otherMembers[0] } });
      const res = await as(ownerToken).post('/schedules/cancel').send({ bookingId: booking.id, cancelledBy: 'MEMBER' });
      expect(res.status).toBe(201);
      expect(res.body.promotedFromWaitlist).toBe(1);

      const b = await prisma.waitlist.findFirstOrThrow({ where: { scheduleId, memberId: otherMembers[1] } });
      expect(b.status).toBe('EXPIRED');
      expect(b.failureReason).toContain('Paket');
      const c = await prisma.booking.findFirstOrThrow({ where: { scheduleId, memberId: otherMembers[2] } });
      expect(c.status).toBe('CONFIRMED');
    });
  });

  describe('late cancel and no-show', () => {
    it('late cancel keeps the policy charge and refunds the rest', async () => {
      const scheduleId = await makeSchedule(2, 2);
      const pkg = await makePackage(otherMembers[0], 4);
      const booked = await book(otherMembers[0], scheduleId, pkg);
      expect(booked.status).toBe(201);

      const res = await as(ownerToken).post('/schedules/cancel').send({ bookingId: booked.body.id, cancelledBy: 'MEMBER' });
      expect(res.status).toBe(201);
      expect(res.body.isLateCancellation).toBe(true);
      expect(res.body.penaltyUnits).toBe(1);
      expect(res.body.refundedUnits).toBe(1);
      expect(res.body.booking.status).toBe('CANCELLED_LATE');
      const p = await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkg } });
      expect(p.remainingUnits).toBe(3);

      const twice = await as(ownerToken).post('/schedules/cancel').send({ bookingId: booked.body.id, cancelledBy: 'MEMBER' });
      expect(twice.status).toBe(400);
    });

    it('member self-cancel cannot waive the penalty', async () => {
      const scheduleId = await makeSchedule(3, 2);
      const pkg = await makePackage(selfMemberId, 2);
      const booked = await as(memberToken)
        .post('/schedules/book/self')
        .send({ studioId: ZEN, scheduleId, memberId: selfMemberId, memberPackageId: pkg });
      expect(booked.status).toBe(201);
      const res = await as(memberToken)
        .post('/schedules/cancel/self')
        .send({ bookingId: booked.body.id, cancelledBy: 'STUDIO', waivePenalty: true });
      expect(res.status).toBe(201);
      expect(res.body.penaltyUnits).toBe(1);
    });

    it('no-show before the session starts -> 400', async () => {
      const scheduleId = await makeSchedule(24, 2);
      const pkg = await makePackage(otherMembers[1], 2);
      const booked = await book(otherMembers[1], scheduleId, pkg);
      const res = await as(ownerToken).patch(`/schedules/no-show/${booked.body.id}`).send({});
      expect(res.status).toBe(400);
    });

    it('no-show after start keeps the no-show charge; check-in afterwards is rejected', async () => {
      const scheduleId = await makeSchedule(-0.5, 2);
      const pkg = await makePackage(otherMembers[2], 4);
      const booked = await book(otherMembers[2], scheduleId, pkg);
      expect(booked.status).toBe(201);

      const res = await as(ownerToken).patch(`/schedules/no-show/${booked.body.id}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.booking.status).toBe('NO_SHOW');
      expect(res.body.penaltyUnits).toBe(1);
      expect(res.body.refundedUnits).toBe(1);
      const p = await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkg } });
      expect(p.remainingUnits).toBe(3);

      const checkIn = await as(ownerToken).patch(`/schedules/check-in/${booked.body.id}`);
      expect(checkIn.status).toBe(400);
    });

    it('member cannot mark a no-show', async () => {
      const res = await as(memberToken).patch('/schedules/no-show/00000000-0000-4000-8000-000000000000').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('trainer substitution', () => {
    let scheduleId: string;

    beforeAll(async () => {
      scheduleId = await makeSchedule(72, 3, trainers[0]);
      const pkg = await makePackage(otherMembers[0], 2);
      expect((await book(otherMembers[0], scheduleId, pkg)).status).toBe(201);
    });

    it('trainer role cannot substitute', async () => {
      const res = await as(trainerToken).post(`/schedules/${scheduleId}/substitute`).send({ trainerId: trainers[1] });
      expect(res.status).toBe(403);
    });

    it('trainer from another tenant -> 404', async () => {
      const res = await as(ownerToken).post(`/schedules/${scheduleId}/substitute`).send({ trainerId: flowTrainerId });
      expect(res.status).toBe(404);
    });

    it('substitutes, remembers the planned trainer, notifies members and audits', async () => {
      const res = await as(ownerToken)
        .post(`/schedules/${scheduleId}/substitute`)
        .send({ trainerId: trainers[1], reason: 'Hastalık' });
      expect(res.status).toBe(201);
      expect(res.body.schedule.trainerId).toBe(trainers[1]);
      expect(res.body.schedule.originalTrainerId).toBe(trainers[0]);
      expect(res.body.membersNotified).toBe(1);
      const audit = await prisma.auditLog.findFirst({ where: { entityId: scheduleId, action: 'schedule.trainer.substitute' } });
      expect(audit).not.toBeNull();
    });

    it('same trainer again -> 400', async () => {
      const res = await as(ownerToken).post(`/schedules/${scheduleId}/substitute`).send({ trainerId: trainers[1] });
      expect(res.status).toBe(400);
    });

    it('switching back to the planned trainer clears originalTrainerId', async () => {
      const res = await as(ownerToken).post(`/schedules/${scheduleId}/substitute`).send({ trainerId: trainers[0] });
      expect(res.status).toBe(201);
      expect(res.body.schedule.originalTrainerId).toBeNull();
    });

    it('substitute who is busy at that time -> 409', async () => {
      await makeSchedule(72.5, 1, trainers[1]);
      const res = await as(ownerToken).post(`/schedules/${scheduleId}/substitute`).send({ trainerId: trainers[1] });
      expect(res.status).toBe(409);
    });
  });
});
