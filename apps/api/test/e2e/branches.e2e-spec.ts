import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W2: branches, staff branch access, home branch, per-branch summary and the
 * cross-studio portfolio. Restores every grant and profile it changes.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';

describe('Branches (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let mainBranch: string;
  let secondBranch: string;
  let flowBranch: string;
  let trainerMembershipId: string;
  let ownerMembershipId: string;
  let selfMemberId: string;
  let otherMemberId: string;
  let serviceTypeId: string;
  let secondBranchRoom: string;

  const scheduleIds: string[] = [];
  const branchIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
  });

  const makeSchedule = async (branchId: string | null, startInHours: number) => {
    const start = new Date(Date.now() + startInHours * HOUR);
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId,
        serviceTypeId,
        title: 'E2E sube',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity: 4,
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
    mainBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN, name: 'Nisantasi Merkez Sube' } })).id;
    secondBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN, name: 'Kadikoy Sube' } })).id;
    flowBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: FLOW } })).id;
    secondBranchRoom = (await prisma.resource.findFirstOrThrow({ where: { studioId: ZEN, branchId: secondBranch } })).id;
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, isActive: true } })).id;

    trainerMembershipId = (
      await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: TRAINER_PHONE } } })
    ).id;
    ownerMembershipId = (
      await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: '+905321000002' } } })
    ).id;
    selfMemberId = (
      await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } } })
    ).id;
    otherMemberId = (
      await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, id: { not: selfMemberId } } })
    ).id;

    ownerToken = await login('+905321000002');
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
  });

  afterAll(async () => {
    await prisma.membershipBranch.deleteMany({ where: { membershipId: trainerMembershipId } });
    await prisma.memberProfile.updateMany({ where: { id: { in: [selfMemberId, otherMemberId] } }, data: { homeBranchId: null } });
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: [...branchIds, trainerMembershipId] } }, { action: { startsWith: 'branch.' }, studioId: ZEN }] },
    });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('branch catalogue', () => {
    it('members list the active branches', async () => {
      const res = await as(memberToken).get(`/branches/studio/${ZEN}`);
      expect(res.status).toBe(200);
      const names = res.body.map((b: any) => b.name);
      expect(names).toEqual(expect.arrayContaining(['Nisantasi Merkez Sube', 'Kadikoy Sube']));
      expect(res.body.every((b: any) => b.studioId === ZEN)).toBe(true);
    });

    it('owner creates a branch; duplicate name -> 409; trainer -> 403', async () => {
      const name = `E2E Sube ${Date.now().toString(36)}`;
      const res = await as(ownerToken).post('/branches').send({ studioId: ZEN, name, address: 'Test', sortOrder: 5 });
      expect(res.status).toBe(201);
      branchIds.push(res.body.id);

      const dup = await as(ownerToken).post('/branches').send({ studioId: ZEN, name });
      expect(dup.status).toBe(409);

      const denied = await as(trainerToken).post('/branches').send({ studioId: ZEN, name: `${name} 2` });
      expect(denied.status).toBe(403);
    });

    it('a branch with upcoming sessions cannot be deactivated', async () => {
      const branchId = branchIds[0];
      await makeSchedule(branchId, 30);
      const res = await as(ownerToken).patch(`/branches/${branchId}`).send({ isActive: false });
      expect(res.status).toBe(400);
    });
  });

  describe('schedules and branches', () => {
    it('a room of a branch places the session in that branch', async () => {
      const start = new Date(Date.now() + 50 * HOUR);
      const res = await as(ownerToken)
        .post('/schedules')
        .send({
          studioId: ZEN,
          serviceTypeId,
          resourceId: secondBranchRoom,
          title: 'E2E oda subesi',
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() + HOUR).toISOString(),
        });
      expect(res.status).toBe(201);
      scheduleIds.push(res.body.id);
      expect(res.body.branchId).toBe(secondBranch);
    });

    it('a room of another branch -> 400', async () => {
      const start = new Date(Date.now() + 52 * HOUR);
      const res = await as(ownerToken)
        .post('/schedules')
        .send({
          studioId: ZEN,
          serviceTypeId,
          branchId: mainBranch,
          resourceId: secondBranchRoom,
          title: 'E2E yanlis oda',
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() + HOUR).toISOString(),
        });
      expect(res.status).toBe(400);
    });

    it('a branch of another tenant -> 400', async () => {
      const start = new Date(Date.now() + 54 * HOUR);
      const res = await as(ownerToken)
        .post('/schedules')
        .send({
          studioId: ZEN,
          serviceTypeId,
          branchId: flowBranch,
          title: 'E2E baska isletme',
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() + HOUR).toISOString(),
        });
      expect(res.status).toBe(400);
    });
  });

  describe('staff branch access', () => {
    let mainSchedule: string;
    let secondSchedule: string;
    let mainBooking: string;
    let secondBooking: string;

    beforeAll(async () => {
      mainSchedule = await makeSchedule(mainBranch, -0.2);
      secondSchedule = await makeSchedule(secondBranch, -0.2);
      mainBooking = (
        await prisma.booking.create({ data: { studioId: ZEN, scheduleId: mainSchedule, memberId: otherMemberId } })
      ).id;
      secondBooking = (
        await prisma.booking.create({ data: { studioId: ZEN, scheduleId: secondSchedule, memberId: otherMemberId } })
      ).id;
    });

    it('owner restricts the trainer to one branch', async () => {
      const res = await as(ownerToken).put(`/branches/staff/${trainerMembershipId}`).send({ branchIds: [secondBranch] });
      expect(res.status).toBe(200);
      const read = await as(ownerToken).get(`/branches/staff/${trainerMembershipId}`);
      expect(read.body.branchIds).toEqual([secondBranch]);
    });

    it('the owner cannot be restricted', async () => {
      const res = await as(ownerToken).put(`/branches/staff/${ownerMembershipId}`).send({ branchIds: [secondBranch] });
      expect(res.status).toBe(400);
    });

    it('branches of another tenant are rejected', async () => {
      const res = await as(ownerToken).put(`/branches/staff/${trainerMembershipId}`).send({ branchIds: [flowBranch] });
      expect(res.status).toBe(400);
    });

    it('restricted trainer sees only their branch (and studio-wide sessions)', async () => {
      const from = new Date(Date.now() - 2 * HOUR).toISOString();
      const to = new Date(Date.now() + 2 * HOUR).toISOString();
      const res = await as(trainerToken).get(`/schedules/studio/${ZEN}?startDate=${from}&endDate=${to}`);
      expect(res.status).toBe(200);
      const ids = res.body.map((s: any) => s.id);
      expect(ids).toContain(secondSchedule);
      expect(ids).not.toContain(mainSchedule);
      expect(res.body.every((s: any) => s.branchId === null || s.branchId === secondBranch)).toBe(true);

      const other = await as(trainerToken).get(`/schedules/studio/${ZEN}?branchId=${mainBranch}`);
      expect(other.status).toBe(403);
    });

    it('restricted trainer can check in only at their branch', async () => {
      expect((await as(trainerToken).patch(`/schedules/check-in/${mainBooking}`)).status).toBe(403);
      expect((await as(trainerToken).patch(`/schedules/check-in/${secondBooking}`)).status).toBe(200);
    });

    it('an empty list lifts the restriction', async () => {
      await as(ownerToken).put(`/branches/staff/${trainerMembershipId}`).send({ branchIds: [] }).expect(200);
      expect((await as(trainerToken).patch(`/schedules/check-in/${mainBooking}`)).status).toBe(200);
    });
  });

  describe('home branch', () => {
    it('member sets their own home branch', async () => {
      const res = await as(memberToken).put('/members/self/home-branch').send({ branchId: secondBranch });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ memberId: selfMemberId, homeBranchId: secondBranch });
    });

    it('staff set a member home branch; other tenant branch -> 400', async () => {
      const ok = await as(ownerToken).put(`/members/${otherMemberId}/home-branch`).send({ branchId: mainBranch });
      expect(ok.status).toBe(200);
      const bad = await as(ownerToken).put(`/members/${otherMemberId}/home-branch`).send({ branchId: flowBranch });
      expect(bad.status).toBe(400);
    });

    it('member list filters by home branch', async () => {
      const res = await as(ownerToken).get(`/members/studio/${ZEN}?homeBranchId=${secondBranch}`);
      expect(res.status).toBe(200);
      const ids = res.body.map((m: any) => m.id);
      expect(ids).toContain(selfMemberId);
      expect(ids).not.toContain(otherMemberId);
    });
  });

  describe('reports', () => {
    it('owner sees a per-branch summary', async () => {
      const from = new Date(Date.now() - 24 * HOUR).toISOString();
      const to = new Date(Date.now() + 24 * HOUR).toISOString();
      const res = await as(ownerToken).get(`/branches/studio/${ZEN}/summary?from=${from}&to=${to}`);
      expect(res.status).toBe(200);
      const second = res.body.find((r: any) => r.branchId === secondBranch);
      expect(second.sessions).toBeGreaterThanOrEqual(1);
      expect(second.attended).toBeGreaterThanOrEqual(1);
      expect(second.homeMembers).toBeGreaterThanOrEqual(1);
      expect(typeof second.revenue).toBe('string');
    });

    it('trainer without reports.view -> 403; bad range -> 400', async () => {
      expect((await as(trainerToken).get(`/branches/studio/${ZEN}/summary`)).status).toBe(403);
      const bad = await as(ownerToken).get(`/branches/studio/${ZEN}/summary?from=2026-02-01&to=2026-01-01`);
      expect(bad.status).toBe(400);
    });

    it('portfolio lists the studios the caller can report on', async () => {
      const owner = await request(server).get('/portfolio/summary').set('Authorization', `Bearer ${ownerToken}`);
      expect(owner.status).toBe(200);
      const zen = owner.body.studios.find((s: any) => s.studioId === ZEN);
      expect(zen.branchCount).toBeGreaterThanOrEqual(2);
      expect(owner.body.studios.some((s: any) => s.studioId === FLOW)).toBe(false);

      const member = await request(server).get('/portfolio/summary').set('Authorization', `Bearer ${memberToken}`);
      expect(member.status).toBe(200);
      expect(member.body.studios).toEqual([]);
    });
  });
});
