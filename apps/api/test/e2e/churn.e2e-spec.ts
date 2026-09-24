import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W12: churn risk scoring, storage, list/summary/detail endpoints, CSV
 * export, contact/snooze actions and the rate-limited recompute trigger.
 * Everything is built fresh in the Zen studio (zen-reformer-pilates) with
 * dates relative to a fixed NOW, which is passed to the recompute endpoint's
 * `now` body field -- honoured only under NODE_ENV=test (see
 * ChurnController.recompute) -- so the resulting scores are deterministic
 * regardless of when the suite actually runs. Everything created here is
 * removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-24T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * DAY);

describe('Churn risk (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let serviceTypeId: string;
  let packageDefId: string;
  let branchA: string;
  let branchB: string;
  let trainerMembershipId: string;
  let trainerRoleTemplateId: string;

  let memberHigh: string; // branch B, many negative signals -> HIGH
  let memberMedium: string; // branch A, moderate signals -> MEDIUM
  let memberLow: string; // branch A, healthy -> LOW
  let memberOnboarding: string; // branch A, joined 10 days ago -> onboarding flag
  let memberFailedPay: string; // branch A, only a failed payment attempt signal

  const membershipIds: string[] = [];
  const userIds: string[] = [];
  const memberIds: string[] = [];
  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];
  const packageIds: string[] = [];
  const subscriptionIds: string[] = [];
  const attemptIds: string[] = [];

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

  const makeMember = async (firstName: string, joinedAt: Date, homeBranchId: string) => {
    const phone = `+9053298${Math.floor(Math.random() * 90000 + 10000)}`;
    const user = await prisma.user.create({ data: { phone, firstName, lastName: 'ChurnE2E', phoneVerifiedAt: new Date() } });
    const memberRoleTemplateId = (await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'member' } })).id;
    const membership = await prisma.membership.create({
      data: { userId: user.id, studioId: ZEN, roleTemplateId: memberRoleTemplateId, status: 'ACTIVE', joinedAt },
    });
    const profile = await prisma.memberProfile.create({
      data: { membershipId: membership.id, studioId: ZEN, homeBranchId },
    });
    userIds.push(user.id);
    membershipIds.push(membership.id);
    memberIds.push(profile.id);
    return profile.id;
  };

  const makeSchedule = async (start: Date, branchId: string) => {
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId,
        serviceTypeId,
        title: 'E2E Churn',
        startTime: start,
        endTime: new Date(start.getTime() + 3600_000),
        capacity: 6,
      },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  const makeBooking = async (memberId: string, start: Date, branchId: string, status: 'ATTENDED' | 'CANCELLED_LATE' | 'NO_SHOW') => {
    const scheduleId = await makeSchedule(start, branchId);
    const b = await prisma.booking.create({ data: { studioId: ZEN, scheduleId, memberId, status } });
    bookingIds.push(b.id);
    return b.id;
  };

  const makePackage = async (
    memberId: string,
    opts: { status: 'ACTIVE' | 'FROZEN'; remainingUnits: number; totalUnits: number; endDate: Date; startDate?: Date },
  ) => {
    const p = await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId,
        packageDefinitionId: packageDefId,
        entitlementKind: 'SESSION_COUNT',
        totalUnits: opts.totalUnits,
        usedUnits: opts.totalUnits - opts.remainingUnits,
        remainingUnits: opts.remainingUnits,
        status: opts.status,
        startDate: opts.startDate ?? daysAgo(20),
        endDate: opts.endDate,
      },
    });
    packageIds.push(p.id);
    return p.id;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, isActive: true } })).id;
    packageDefId = (await prisma.packageDefinition.findFirstOrThrow({ where: { studioId: ZEN } })).id;

    trainerMembershipId = (
      await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: TRAINER_PHONE } } })
    ).id;
    trainerRoleTemplateId = (await prisma.membership.findUniqueOrThrow({ where: { id: trainerMembershipId } })).roleTemplateId;

    const bA = await prisma.branch.create({ data: { studioId: ZEN, name: `E2E Churn Sube A ${Date.now()}` } });
    const bB = await prisma.branch.create({ data: { studioId: ZEN, name: `E2E Churn Sube B ${Date.now()}` } });
    branchA = bA.id;
    branchB = bB.id;

    // --- MemberHigh (branch B): never attended, frozen/near-empty/near-ending package, late cancels + no-shows.
    memberHigh = await makeMember('ChurnHigh', daysAgo(500), branchB);
    await makeBooking(memberHigh, daysAgo(5), branchB, 'CANCELLED_LATE');
    await makeBooking(memberHigh, daysAgo(3), branchB, 'CANCELLED_LATE');
    await makeBooking(memberHigh, daysAgo(2), branchB, 'NO_SHOW');
    await makeBooking(memberHigh, daysAgo(1), branchB, 'NO_SHOW');
    await makePackage(memberHigh, { status: 'FROZEN', remainingUnits: 1, totalUnits: 10, endDate: daysFromNow(2) });

    // --- MemberMedium (branch A): attendance dropped to zero, package ending soon, one late cancel.
    memberMedium = await makeMember('ChurnMedium', daysAgo(500), branchA);
    await makeBooking(memberMedium, daysAgo(35), branchA, 'ATTENDED'); // in the 28-56 day window, not the last 28
    await makeBooking(memberMedium, daysAgo(10), branchA, 'CANCELLED_LATE');
    await makePackage(memberMedium, { status: 'ACTIVE', remainingUnits: 6, totalUnits: 10, endDate: daysFromNow(3) });

    // --- MemberLow (branch A): healthy, steady attendance, no other issues.
    memberLow = await makeMember('ChurnLow', daysAgo(500), branchA);
    await makeBooking(memberLow, daysAgo(3), branchA, 'ATTENDED');
    await makeBooking(memberLow, daysAgo(10), branchA, 'ATTENDED');
    await makeBooking(memberLow, daysAgo(40), branchA, 'ATTENDED');
    await makePackage(memberLow, { status: 'ACTIVE', remainingUnits: 8, totalUnits: 10, endDate: daysFromNow(90) });

    // --- MemberOnboarding (branch A): joined 10 days ago, no history at all yet.
    memberOnboarding = await makeMember('ChurnOnboarding', daysAgo(10), branchA);

    // --- MemberFailedPay (branch A): healthy attendance but a failed dunning attempt in the last 28 days.
    memberFailedPay = await makeMember('ChurnFailedPay', daysAgo(500), branchA);
    await makeBooking(memberFailedPay, daysAgo(3), branchA, 'ATTENDED');
    await makeBooking(memberFailedPay, daysAgo(40), branchA, 'ATTENDED');
    const sub = await prisma.memberSubscription.create({
      data: {
        studioId: ZEN,
        memberId: memberFailedPay,
        packageDefinitionId: packageDefId,
        status: 'PAST_DUE',
        currentPeriodStart: daysAgo(35),
        currentPeriodEnd: daysFromNow(-5),
        nextChargeAt: daysFromNow(1),
      },
    });
    subscriptionIds.push(sub.id);
    const attempt = await prisma.paymentAttempt.create({
      data: { studioId: ZEN, memberSubscriptionId: sub.id, attemptNumber: 1, status: 'FAILED', createdAt: daysAgo(5) },
    });
    attemptIds.push(attempt.id);

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
  });

  afterAll(async () => {
    await prisma.memberRiskHistory.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.memberRiskSnapshot.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.auditLog.deleteMany({ where: { studioId: ZEN, entityType: 'MemberProfile', entityId: { in: memberIds } } });
    await prisma.auditLog.deleteMany({ where: { studioId: ZEN, action: 'churn.recompute' } });
    await prisma.roleTemplatePermission
      .delete({ where: { roleTemplateId_permissionKey: { roleTemplateId: trainerRoleTemplateId, permissionKey: 'reports.view' } } })
      .catch(() => undefined);
    await prisma.membershipBranch.deleteMany({ where: { membershipId: trainerMembershipId } });
    await prisma.paymentAttempt.deleteMany({ where: { id: { in: attemptIds } } });
    await prisma.memberSubscription.deleteMany({ where: { id: { in: subscriptionIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.memberProfile.deleteMany({ where: { id: { in: memberIds } } });
    await prisma.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: [branchA, branchB] } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('recompute', () => {
    it('owner (members.manage) recomputes the studio using the fixture NOW', async () => {
      const res = await as(ownerToken).post(`/churn/studio/${ZEN}/recompute`, { now: NOW.toISOString() });
      expect(res.status).toBe(201);
      expect(res.body.membersScored).toBeGreaterThan(0);
    });

    it('a second call within 10 minutes is rate-limited (429)', async () => {
      const res = await as(ownerToken).post(`/churn/studio/${ZEN}/recompute`, { now: NOW.toISOString() });
      expect(res.status).toBe(429);
    });

    it('member (no members.manage) -> 403', async () => {
      const res = await as(memberToken).post(`/churn/studio/${ZEN}/recompute`, { now: NOW.toISOString() });
      expect(res.status).toBe(403);
    });
  });

  describe('scoring outcomes', () => {
    it('memberHigh scores HIGH with the expected reasons', async () => {
      const res = await as(ownerToken).get(`/churn/studio/${ZEN}/members/${memberHigh}`);
      expect(res.status).toBe(200);
      expect(res.body.level).toBe('HIGH');
      expect(res.body.onboarding).toBe(false);
      const reasonKeys = res.body.reasons.map((r: any) => r.key);
      expect(reasonKeys).toEqual(
        expect.arrayContaining(['inactive', 'package_frozen', 'package_low_units', 'package_ending_soon', 'late_cancels_no_shows']),
      );
    });

    it('memberMedium scores MEDIUM', async () => {
      const res = await as(ownerToken).get(`/churn/studio/${ZEN}/members/${memberMedium}`);
      expect(res.status).toBe(200);
      expect(res.body.level).toBe('MEDIUM');
      expect(res.body.score).toBeGreaterThanOrEqual(40);
      expect(res.body.score).toBeLessThan(70);
    });

    it('memberLow scores LOW with no reasons', async () => {
      const res = await as(ownerToken).get(`/churn/studio/${ZEN}/members/${memberLow}`);
      expect(res.status).toBe(200);
      expect(res.body.level).toBe('LOW');
      expect(res.body.reasons).toEqual([]);
    });

    it('memberOnboarding is flagged and skips attendance/inactivity signals', async () => {
      const res = await as(ownerToken).get(`/churn/studio/${ZEN}/members/${memberOnboarding}`);
      expect(res.status).toBe(200);
      expect(res.body.onboarding).toBe(true);
      expect(res.body.reasons).toEqual([expect.objectContaining({ key: 'onboarding' })]);
    });

    it('memberFailedPay has a failed_payments reason', async () => {
      const res = await as(ownerToken).get(`/churn/studio/${ZEN}/members/${memberFailedPay}`);
      expect(res.status).toBe(200);
      expect(res.body.reasons.some((r: any) => r.key === 'failed_payments')).toBe(true);
    });
  });

  describe('list, summary and CSV', () => {
    it('lists members sorted by score desc, filterable by level', async () => {
      const res = await as(ownerToken).get(`/churn/studio/${ZEN}/members?limit=100`);
      expect(res.status).toBe(200);
      const scores = res.body.items.map((i: any) => i.score);
      expect([...scores]).toEqual([...scores].sort((a, b) => b - a));

      const highOnly = await as(ownerToken).get(`/churn/studio/${ZEN}/members?level=HIGH&limit=100`);
      expect(highOnly.status).toBe(200);
      expect(highOnly.body.items.every((i: any) => i.level === 'HIGH')).toBe(true);
      expect(highOnly.body.items.some((i: any) => i.memberId === memberHigh)).toBe(true);
    });

    it('summary counts per level, non-negative', async () => {
      const res = await as(ownerToken).get(`/churn/studio/${ZEN}/summary`);
      expect(res.status).toBe(200);
      expect(res.body.counts).toHaveLength(3);
      for (const row of res.body.counts) {
        expect(row.count).toBeGreaterThanOrEqual(0);
        expect(row.previousCount).toBeGreaterThanOrEqual(0);
      }
      const high = res.body.counts.find((c: any) => c.level === 'HIGH');
      expect(high.count).toBeGreaterThanOrEqual(1);
    });

    it('CSV export has a BOM, semicolons and Turkish headers', async () => {
      const res = await as(ownerToken).get(`/churn/studio/${ZEN}/members?format=csv&level=HIGH`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      const header = res.text.slice(1).split('\r\n')[0];
      expect(header).toBe('Ad Soyad;Telefon;Risk seviyesi;Puan;Önceki puan;Yeni üye;Son katılım;Paket bitişi;Nedenler;Görüşüldü');
    });

    it('owner (members.contact.view) sees phone numbers', async () => {
      const res = await as(ownerToken).get(`/churn/studio/${ZEN}/members/${memberHigh}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.phone).toBe('string');
    });
  });

  describe('authorization and branch restriction', () => {
    it('trainer without reports.view -> 403', async () => {
      const res = await as(trainerToken).get(`/churn/studio/${ZEN}/members`);
      expect(res.status).toBe(403);
    });

    it('owner of another studio -> 403 for this studio', async () => {
      const flowOwnerToken = await login('+905321000022');
      const res = await as(flowOwnerToken, ZEN).get(`/churn/studio/${ZEN}/members`);
      expect(res.status).toBe(403);
    });

    it('a trainer restricted to branch B, with reports.view granted, sees only branch B members and no phone', async () => {
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

      const res = await as(trainerToken).get(`/churn/studio/${ZEN}/members?limit=100`);
      expect(res.status).toBe(200);
      const ids = res.body.items.map((i: any) => i.memberId);
      expect(ids).toContain(memberHigh);
      expect(ids).not.toContain(memberMedium);
      expect(ids).not.toContain(memberLow);
      expect(res.body.items.every((i: any) => i.phone === undefined)).toBe(true);

      const detail = await as(trainerToken).get(`/churn/studio/${ZEN}/members/${memberMedium}`);
      expect(detail.status).toBe(403);

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

    it('cross-tenant: FLOW studio cannot be queried with the ZEN owner token bound to FLOW header without membership', async () => {
      const res = await as(ownerToken, FLOW).get(`/churn/studio/${FLOW}/members`);
      expect(res.status).toBe(403);
    });
  });

  describe('actions: contacted and snooze', () => {
    it('marks a member as contacted with a note and records an audit entry', async () => {
      const res = await as(ownerToken).post(`/churn/studio/${ZEN}/members/${memberMedium}/contacted`, { note: 'Telefonla arandi' });
      expect(res.status).toBe(201);
      expect(res.body.contactedAt).toEqual(expect.any(String));

      const audit = await prisma.auditLog.findFirst({ where: { studioId: ZEN, action: 'churn.contacted', entityId: memberMedium } });
      expect(audit).toBeTruthy();
    });

    it('member (no members.manage) cannot mark contacted', async () => {
      const res = await as(memberToken).post(`/churn/studio/${ZEN}/members/${memberMedium}/contacted`, { note: 'x' });
      expect(res.status).toBe(403);
    });

    it('snoozes a member out of the default list, includeSnoozed brings it back', async () => {
      const snoozeRes = await as(ownerToken).post(`/churn/studio/${ZEN}/members/${memberLow}/snooze`, { days: 14 });
      expect(snoozeRes.status).toBe(201);
      expect(snoozeRes.body.snoozedUntil).toEqual(expect.any(String));

      const hidden = await as(ownerToken).get(`/churn/studio/${ZEN}/members?limit=100`);
      expect(hidden.body.items.some((i: any) => i.memberId === memberLow)).toBe(false);

      const shown = await as(ownerToken).get(`/churn/studio/${ZEN}/members?limit=100&includeSnoozed=true`);
      expect(shown.body.items.some((i: any) => i.memberId === memberLow)).toBe(true);
    });
  });
});
