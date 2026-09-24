import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W13: occupancy, revenue, members, renewal, cohorts and trainer reports,
 * plus CSV export. All fixtures live in March 2025 and under two branches
 * created just for this spec, so seed data (which schedules near "now")
 * cannot shift the numbers. Everything created here is removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';

const FROM = '2025-03-01T00:00:00.000Z';
const TO = '2025-04-01T00:00:00.000Z';

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let branchA: string;
  let branchB: string;
  let serviceTypeId: string;
  let pdA: string;
  let pdB: string;
  let trainer1Id: string; // Selin (TRAINER_PHONE)
  let trainer2Id: string;
  let trainerMembershipId: string;
  let trainerRoleTemplateId: string;
  let memberX: string; // an existing Zen member used only as a booking filler
  let memberA: string;
  let memberB: string;
  let memberC: string;
  let memberAMembershipId: string;
  let memberBMembershipId: string;
  let memberCMembershipId: string;
  let memberAUserId: string;
  let memberBUserId: string;
  let memberCUserId: string;

  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];
  const paymentIds: string[] = [];
  const packageIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, isActive: true } })).id;

    const packageDefs = await prisma.packageDefinition.findMany({ where: { studioId: ZEN }, take: 2 });
    pdA = packageDefs[0].id;
    pdB = packageDefs[1]?.id ?? packageDefs[0].id;

    trainerMembershipId = (
      await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: TRAINER_PHONE } } })
    ).id;
    const trainerMembership = await prisma.membership.findUniqueOrThrow({ where: { id: trainerMembershipId } });
    trainerRoleTemplateId = trainerMembership.roleTemplateId;
    trainer1Id = (await prisma.trainerProfile.findUniqueOrThrow({ where: { membershipId: trainerMembershipId } })).id;
    trainer2Id = (
      await prisma.trainerProfile.findFirstOrThrow({ where: { studioId: ZEN, id: { not: trainer1Id } } })
    ).id;
    memberX = (
      await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: { not: MEMBER_PHONE } } } } })
    ).id;

    const memberRoleTemplateId = (
      await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'member' } })
    ).id;

    // Two branches used only by this spec.
    const bA = await prisma.branch.create({ data: { studioId: ZEN, name: `E2E Rapor Sube A ${Date.now()}` } });
    const bB = await prisma.branch.create({ data: { studioId: ZEN, name: `E2E Rapor Sube B ${Date.now()}` } });
    branchA = bA.id;
    branchB = bB.id;

    // Three fresh members, all with home branch A.
    const makeMember = async (firstName: string, joinedAt: Date) => {
      const phone = `+9053299${Math.floor(Math.random() * 90000 + 10000)}`;
      const user = await prisma.user.create({ data: { phone, firstName, lastName: 'E2E', phoneVerifiedAt: new Date() } });
      const membership = await prisma.membership.create({
        data: { userId: user.id, studioId: ZEN, roleTemplateId: memberRoleTemplateId, status: 'ACTIVE', joinedAt },
      });
      const profile = await prisma.memberProfile.create({
        data: { membershipId: membership.id, studioId: ZEN, homeBranchId: branchA },
      });
      return { userId: user.id, membershipId: membership.id, memberId: profile.id };
    };

    const a = await makeMember('MemberA', new Date('2024-06-01T00:00:00.000Z'));
    const b = await makeMember('MemberB', new Date('2024-06-01T00:00:00.000Z'));
    const c = await makeMember('MemberC', new Date('2025-03-15T00:00:00.000Z'));
    memberA = a.memberId;
    memberAMembershipId = a.membershipId;
    memberAUserId = a.userId;
    memberB = b.memberId;
    memberBMembershipId = b.membershipId;
    memberBUserId = b.userId;
    memberC = c.memberId;
    memberCMembershipId = c.membershipId;
    memberCUserId = c.userId;

    // Packages: A renews within the 14-day window, B does not (churns).
    const mp1 = await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId: memberA,
        packageDefinitionId: pdA,
        entitlementKind: 'SESSION_COUNT',
        totalUnits: 10,
        usedUnits: 10,
        remainingUnits: 0,
        status: 'EXPIRED',
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-03-10T00:00:00.000Z'),
      },
    });
    const mp2 = await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId: memberA,
        packageDefinitionId: pdA,
        entitlementKind: 'SESSION_COUNT',
        totalUnits: 10,
        usedUnits: 0,
        remainingUnits: 10,
        status: 'ACTIVE',
        startDate: new Date('2025-03-12T00:00:00.000Z'),
        endDate: new Date('2025-05-01T00:00:00.000Z'),
      },
    });
    const mp3 = await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId: memberB,
        packageDefinitionId: pdB,
        entitlementKind: 'SESSION_COUNT',
        totalUnits: 8,
        usedUnits: 8,
        remainingUnits: 0,
        status: 'EXPIRED',
        startDate: new Date('2024-12-01T00:00:00.000Z'),
        endDate: new Date('2025-03-05T00:00:00.000Z'),
      },
    });
    packageIds.push(mp1.id, mp2.id, mp3.id);

    // Payments: two in branch A (tied to memberA's packages), one in branch B (no package).
    const pay1 = await prisma.payment.create({
      data: { studioId: ZEN, memberId: memberA, memberPackageId: mp2.id, branchId: branchA, amount: '1000.00', paymentMethod: 'CASH', paymentStatus: 'COMPLETED', paidAt: new Date('2025-03-12T08:00:00.000Z') },
    });
    const pay2 = await prisma.payment.create({
      data: { studioId: ZEN, memberId: memberB, memberPackageId: null, branchId: branchB, amount: '500.50', paymentMethod: 'CREDIT_CARD_POS', paymentStatus: 'COMPLETED', paidAt: new Date('2025-03-20T08:00:00.000Z') },
    });
    const pay3 = await prisma.payment.create({
      data: { studioId: ZEN, memberId: memberA, memberPackageId: mp1.id, branchId: branchA, amount: '250.25', paymentMethod: 'CASH', paymentStatus: 'COMPLETED', paidAt: new Date('2025-03-25T08:00:00.000Z') },
    });
    paymentIds.push(pay1.id, pay2.id, pay3.id);

    // Schedules and bookings for occupancy / trainer reports.
    const s1 = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId: branchA,
        serviceTypeId,
        trainerId: trainer1Id,
        title: 'E2E Rapor S1',
        startTime: new Date('2025-03-03T09:00:00.000Z'), // Monday, 12:00 Europe/Istanbul
        endTime: new Date('2025-03-03T10:00:00.000Z'),
        capacity: 4,
      },
    });
    const s2 = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId: branchB,
        serviceTypeId,
        trainerId: trainer1Id,
        originalTrainerId: trainer2Id, // Selin substitutes for Burak
        title: 'E2E Rapor S2',
        startTime: new Date('2025-03-04T09:00:00.000Z'), // Tuesday, 12:00 Europe/Istanbul
        endTime: new Date('2025-03-04T10:00:00.000Z'),
        capacity: 2,
      },
    });
    const s3 = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId: null, // studio-wide, visible to restricted staff too
        serviceTypeId,
        trainerId: trainer2Id,
        title: 'E2E Rapor S3',
        startTime: new Date('2025-03-10T09:00:00.000Z'),
        endTime: new Date('2025-03-10T10:00:00.000Z'),
        capacity: 5,
      },
    });
    scheduleIds.push(s1.id, s2.id, s3.id);

    const b1 = await prisma.booking.create({ data: { studioId: ZEN, scheduleId: s1.id, memberId: memberA, status: 'ATTENDED' } });
    const b2 = await prisma.booking.create({ data: { studioId: ZEN, scheduleId: s1.id, memberId: memberB, status: 'ATTENDED' } });
    const b3 = await prisma.booking.create({ data: { studioId: ZEN, scheduleId: s1.id, memberId: memberC, status: 'NO_SHOW' } });
    const b4 = await prisma.booking.create({
      data: { studioId: ZEN, scheduleId: s1.id, memberId: memberX, status: 'CANCELLED_LATE', isLateCancellation: true },
    });
    const b5 = await prisma.booking.create({ data: { studioId: ZEN, scheduleId: s2.id, memberId: memberA, status: 'ATTENDED' } });
    const b6 = await prisma.booking.create({ data: { studioId: ZEN, scheduleId: s2.id, memberId: memberX, status: 'ATTENDED' } });
    bookingIds.push(b1.id, b2.id, b3.id, b4.id, b5.id, b6.id);

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
  });

  afterAll(async () => {
    await prisma.roleTemplatePermission
      .delete({ where: { roleTemplateId_permissionKey: { roleTemplateId: trainerRoleTemplateId, permissionKey: 'reports.view' } } })
      .catch(() => undefined);
    await prisma.membershipBranch.deleteMany({ where: { membershipId: trainerMembershipId } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.memberProfile.deleteMany({ where: { id: { in: [memberA, memberB, memberC] } } });
    await prisma.membership.deleteMany({ where: { id: { in: [memberAMembershipId, memberBMembershipId, memberCMembershipId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [memberAUserId, memberBUserId, memberCUserId] } } });
    await prisma.branch.deleteMany({ where: { id: { in: [branchA, branchB] } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('occupancy', () => {
    it('reports sessions/capacity/booked/attended by day, service type and heatmap', async () => {
      const res = await as(ownerToken).get(`/reports/studio/${ZEN}/occupancy?from=${FROM}&to=${TO}`);
      expect(res.status).toBe(200);

      const day1 = res.body.byDay.find((d: any) => d.date === '2025-03-03');
      expect(day1).toEqual({ date: '2025-03-03', sessions: 1, capacity: 4, booked: 3, attended: 2, occupancy: 0.75 });
      const day2 = res.body.byDay.find((d: any) => d.date === '2025-03-04');
      expect(day2).toEqual({ date: '2025-03-04', sessions: 1, capacity: 2, booked: 2, attended: 2, occupancy: 1 });
      const day3 = res.body.byDay.find((d: any) => d.date === '2025-03-10');
      expect(day3).toEqual({ date: '2025-03-10', sessions: 1, capacity: 5, booked: 0, attended: 0, occupancy: 0 });

      const svcRow = res.body.byServiceType.find((s: any) => s.serviceTypeId === serviceTypeId);
      expect(svcRow.sessions).toBeGreaterThanOrEqual(3);

      // Monday 12:00 Europe/Istanbul (weekday 0, hour 12) covers S1 and S3.
      const mondayNoon = res.body.heatmap.find((c: any) => c.weekday === 0 && c.hour === 12);
      expect(mondayNoon).toEqual({ weekday: 0, hour: 12, sessions: 2, capacity: 9, booked: 3, occupancy: 0.333 });
      const tuesdayNoon = res.body.heatmap.find((c: any) => c.weekday === 1 && c.hour === 12);
      expect(tuesdayNoon).toEqual({ weekday: 1, hour: 12, sessions: 1, capacity: 2, booked: 2, occupancy: 1 });
      expect(res.body.heatmap).toHaveLength(7 * 24);
    });

    it('scoped to branch A shows only that branch', async () => {
      const res = await as(ownerToken).get(`/reports/studio/${ZEN}/occupancy?from=${FROM}&to=${TO}&branchId=${branchA}`);
      expect(res.status).toBe(200);
      expect(res.body.byDay).toHaveLength(1);
      expect(res.body.byDay[0]).toMatchObject({ date: '2025-03-03', sessions: 1, capacity: 4, booked: 3 });
    });

    it('CSV export has a BOM, semicolons and Turkish headers', async () => {
      const res = await as(ownerToken).get(`/reports/studio/${ZEN}/occupancy?from=${FROM}&to=${TO}&branchId=${branchA}&format=csv`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      const [header, firstRow] = res.text.slice(1).split('\r\n');
      expect(header).toBe('Tarih;Seans;Kapasite;Rezervasyon;Katılım;Doluluk');
      expect(firstRow).toBe('2025-03-03;1;4;3;2;%75');
    });
  });

  describe('revenue', () => {
    it('sums completed payments by period, method and package', async () => {
      const res = await as(ownerToken).get(`/reports/studio/${ZEN}/revenue?from=${FROM}&to=${TO}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe('1750.75');

      const cash = res.body.byMethod.find((m: any) => m.paymentMethod === 'CASH');
      expect(cash).toEqual({ paymentMethod: 'CASH', amount: '1250.25', paymentCount: 2 });
      const card = res.body.byMethod.find((m: any) => m.paymentMethod === 'CREDIT_CARD_POS');
      expect(card).toEqual({ paymentMethod: 'CREDIT_CARD_POS', amount: '500.50', paymentCount: 1 });

      const pkgRow = res.body.byPackage.find((p: any) => p.packageDefinitionId === pdA);
      expect(pkgRow).toEqual({ packageDefinitionId: pdA, packageDefinitionName: expect.any(String), amount: '1250.25', paymentCount: 2 });

      expect(res.body.byPeriod.map((p: any) => p.amount).sort()).toEqual(['1000.00', '250.25', '500.50'].sort());
      expect(res.body.refundTotal).toBe('0.00');
      expect(res.body.netTotal).toBe(res.body.total);
    });

    it('refunds are reported separately and fully refunded payments stay in gross revenue', async () => {
      const before = await as(ownerToken).get(`/reports/studio/${ZEN}/revenue?from=${FROM}&to=${TO}`);
      const [first, second] = paymentIds;
      await prisma.payment.update({ where: { id: first }, data: { refundedAmount: '100.00' } });
      const secondRow = await prisma.payment.findUniqueOrThrow({ where: { id: second } });
      await prisma.payment.update({
        where: { id: second },
        data: { refundedAmount: secondRow.amount, paymentStatus: 'REFUNDED' },
      });
      try {
        const res = await as(ownerToken).get(`/reports/studio/${ZEN}/revenue?from=${FROM}&to=${TO}`);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(before.body.total);
        const expectedRefund = (100 + Number(secondRow.amount)).toFixed(2);
        expect(res.body.refundTotal).toBe(expectedRefund);
        expect(res.body.netTotal).toBe((Number(before.body.total) - Number(expectedRefund)).toFixed(2));
      } finally {
        await prisma.payment.update({ where: { id: first }, data: { refundedAmount: '0.00' } });
        await prisma.payment.update({ where: { id: second }, data: { refundedAmount: '0.00', paymentStatus: 'COMPLETED' } });
      }
    });

    it('scoped to branch A excludes branch B payments', async () => {
      const res = await as(ownerToken).get(`/reports/studio/${ZEN}/revenue?from=${FROM}&to=${TO}&branchId=${branchA}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe('1250.25');
    });
  });

  describe('members and renewal', () => {
    it('members report: active, new, churn and ARPU scoped to branch A', async () => {
      const res = await as(ownerToken).get(`/reports/studio/${ZEN}/members?from=${FROM}&to=${TO}&branchId=${branchA}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        from: expect.any(String),
        to: expect.any(String),
        activeMembers: 3,
        newMembers: 1,
        churnedMembers: 1,
        revenue: '1250.25',
        arpu: '416.75',
      });
    });

    it('renewal report: renewal rate over branch A', async () => {
      const res = await as(ownerToken).get(`/reports/studio/${ZEN}/renewal?from=${FROM}&to=${TO}&branchId=${branchA}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ expiredPackages: 2, renewedPackages: 1, renewalRate: 0.5 });
    });
  });

  describe('cohorts', () => {
    it('groups members by first-purchase month with monthly retention', async () => {
      const res = await as(ownerToken).get(`/reports/studio/${ZEN}/cohorts?branchId=${branchA}`);
      expect(res.status).toBe(200);
      const jan = res.body.cohorts.find((c: any) => c.cohortMonth === '2025-01');
      expect(jan.cohortSize).toBe(1);
      expect(jan.retention.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
      const dec = res.body.cohorts.find((c: any) => c.cohortMonth === '2024-12');
      expect(dec.cohortSize).toBe(1);
      expect(dec.retention.slice(0, 4)).toEqual([1, 1, 1, 1]);
      expect(dec.retention[4]).toBe(0);
    });
  });

  describe('trainers', () => {
    it('per-trainer sessions, occupancy, no-shows, late cancels and substitutions', async () => {
      const res = await as(ownerToken).get(`/reports/studio/${ZEN}/trainers?from=${FROM}&to=${TO}`);
      expect(res.status).toBe(200);
      const t1 = res.body.trainers.find((t: any) => t.trainerProfileId === trainer1Id);
      expect(t1).toEqual({
        trainerProfileId: trainer1Id,
        trainerName: expect.any(String),
        sessions: 2,
        capacity: 6,
        booked: 5,
        attended: 4,
        occupancy: 0.833,
        noShows: 1,
        lateCancellations: 1,
        substitutions: 1,
      });
      const t2 = res.body.trainers.find((t: any) => t.trainerProfileId === trainer2Id);
      expect(t2).toMatchObject({ sessions: 1, capacity: 5, booked: 0, attended: 0, substitutions: 0 });
    });
  });

  describe('authorization', () => {
    it('trainer without reports.view -> 403', async () => {
      const res = await as(trainerToken).get(`/reports/studio/${ZEN}/occupancy?from=${FROM}&to=${TO}`);
      expect(res.status).toBe(403);
    });

    it('member -> 403 (no reports.view)', async () => {
      const res = await as(memberToken).get(`/reports/studio/${ZEN}/occupancy?from=${FROM}&to=${TO}`);
      expect(res.status).toBe(403);
    });

    it('owner of another studio -> 403 for this studio', async () => {
      const flowOwnerToken = await login('+905321000022');
      const res = await as(flowOwnerToken, ZEN).get(`/reports/studio/${ZEN}/occupancy?from=${FROM}&to=${TO}`);
      expect(res.status).toBe(403);
    });

    it('owner cannot report on a studio they do not belong to', async () => {
      const res = await as(ownerToken, FLOW).get(`/reports/studio/${FLOW}/occupancy?from=${FROM}&to=${TO}`);
      expect(res.status).toBe(403);
    });

    it('bad range -> 400', async () => {
      const res = await as(ownerToken).get(`/reports/studio/${ZEN}/occupancy?from=2026-02-01&to=2026-01-01`);
      expect(res.status).toBe(400);
    });
  });

  describe('branch-restricted staff', () => {
    it('a trainer restricted to branch B only sees branch B (and studio-wide) data', async () => {
      await prisma.roleTemplatePermission.upsert({
        where: { roleTemplateId_permissionKey: { roleTemplateId: trainerRoleTemplateId, permissionKey: 'reports.view' } },
        create: { roleTemplateId: trainerRoleTemplateId, permissionKey: 'reports.view' },
        update: {},
      });

      const grant = await request(server)
        .put(`/branches/staff/${trainerMembershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ branchIds: [branchB] });
      expect(grant.status).toBe(200);

      const occ = await as(trainerToken).get(`/reports/studio/${ZEN}/occupancy?from=${FROM}&to=${TO}`);
      expect(occ.status).toBe(200);
      expect(occ.body.byDay.map((d: any) => d.date).sort()).toEqual(['2025-03-04', '2025-03-10']);

      const rev = await as(trainerToken).get(`/reports/studio/${ZEN}/revenue?from=${FROM}&to=${TO}`);
      expect(rev.status).toBe(200);
      expect(rev.body.total).toBe('500.50');

      // Reset: lift the branch restriction and revoke the temporary permission.
      const reset = await request(server)
        .put(`/branches/staff/${trainerMembershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ branchIds: [] });
      expect(reset.status).toBe(200);
      await prisma.roleTemplatePermission.delete({
        where: { roleTemplateId_permissionKey: { roleTemplateId: trainerRoleTemplateId, permissionKey: 'reports.view' } },
      });
    });
  });
});
