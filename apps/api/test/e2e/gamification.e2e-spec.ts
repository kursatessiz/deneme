import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W16: streaks, milestones, badges and monthly goals.
 *
 * Every fixture booking is created directly with Prisma (never through the
 * booking API) so counts are exact and independent of other suites. All
 * seeded users share the same password (see packages/database/prisma/seed.ts).
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const MEMBER_PHONE = '+905321000016';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

describe('Gamification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let mainBranch: string;
  let serviceTypeId: string;

  let ownerToken: string;
  let memberToken: string; // demo member, MEMBER_PHONE
  let memberAToken: string;
  let memberBToken: string;
  let memberCToken: string;

  let demoMemberId: string;
  let memberAId: string;
  let memberBId: string;
  let memberCId: string;

  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];
  const badgeDefIds: string[] = [];
  const goalMonths: { memberId: string; month: string }[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  /** Directly creates a schedule + a booking with the given status/date; never goes through the booking API. */
  const makeAttendedFixture = async (memberId: string, startTime: Date) => {
    const schedule = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId: mainBranch,
        serviceTypeId,
        title: 'E2E oyunlastirma seansi',
        startTime,
        endTime: new Date(startTime.getTime() + HOUR),
        capacity: 6,
      },
    });
    scheduleIds.push(schedule.id);
    const booking = await prisma.booking.create({
      data: {
        studioId: ZEN,
        scheduleId: schedule.id,
        memberId,
        status: 'ATTENDED',
        unitsCharged: 0,
        checkInAt: startTime,
      },
    });
    bookingIds.push(booking.id);
    return booking.id;
  };

  /** Creates a CONFIRMED booking to be checked in through the real API. */
  const makeConfirmedBooking = async (memberId: string, startTime: Date) => {
    const schedule = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId: mainBranch,
        serviceTypeId,
        title: 'E2E check-in seansi',
        startTime,
        endTime: new Date(startTime.getTime() + HOUR),
        capacity: 6,
      },
    });
    scheduleIds.push(schedule.id);
    const booking = await prisma.booking.create({
      data: { studioId: ZEN, scheduleId: schedule.id, memberId, status: 'CONFIRMED', unitsCharged: 0 },
    });
    bookingIds.push(booking.id);
    return booking.id;
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
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN } })).id;

    ownerToken = await login(OWNER_PHONE);
    memberToken = await login(MEMBER_PHONE);

    const demoMember = await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } } });
    demoMemberId = demoMember.id;

    const others = await prisma.memberProfile.findMany({
      where: { studioId: ZEN, membership: { user: { phone: { not: MEMBER_PHONE } } } },
      include: { membership: { include: { user: true } } },
      take: 3,
      orderBy: { id: 'asc' },
    });
    expect(others.length).toBeGreaterThanOrEqual(3);
    memberAId = others[0].id;
    memberBId = others[1].id;
    memberCId = others[2].id;
    memberAToken = await login(others[0].membership.user.phone);
    memberBToken = await login(others[1].membership.user.phone);
    memberCToken = await login(others[2].membership.user.phone);

    // Fresh baseline: gamification is off by default in the seed's e2e fixture
    // state only for THIS test's own members' leaderboard opt-in.
    await prisma.memberProfile.updateMany({
      where: { id: { in: [demoMemberId, memberAId, memberBId, memberCId] } },
      data: { leaderboardOptIn: false },
    });
  });

  afterAll(async () => {
    await prisma.memberGoal.deleteMany({ where: { studioId: ZEN, memberId: { in: [demoMemberId, memberAId, memberBId, memberCId] } } });
    await prisma.memberBadge.deleteMany({ where: { studioId: ZEN, memberId: { in: [demoMemberId, memberAId, memberBId, memberCId] } } });
    await prisma.badgeDefinition.deleteMany({ where: { id: { in: badgeDefIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.memberProfile.updateMany({
      where: { id: { in: [demoMemberId, memberAId, memberBId, memberCId] } },
      data: { leaderboardOptIn: false },
    });
    await prisma.studio.update({ where: { id: ZEN }, data: { gamificationEnabled: true } });
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Badge definitions CRUD (staff)
  // ---------------------------------------------------------------------------

  let milestone3BadgeId: string;
  let streak3BadgeId: string;

  describe('badge definitions (staff CRUD)', () => {
    it('a member without studio.settings.manage cannot create a badge definition', async () => {
      const res = await as(memberToken)
        .post(`/gamification/studio/${ZEN}/badge-definitions`)
        .send({ key: 'e2e-should-fail', name: 'Should fail', kind: 'MILESTONE_SESSIONS', threshold: { kind: 'MILESTONE_SESSIONS', sessions: 5 } });
      expect(res.status).toBe(403);
    });

    it('owner creates a low-threshold milestone and streak badge for deterministic testing', async () => {
      const milestoneRes = await as(ownerToken)
        .post(`/gamification/studio/${ZEN}/badge-definitions`)
        .send({
          key: 'e2e-milestone-3',
          name: 'E2E: 3 seans',
          description: 'Test rozeti',
          kind: 'MILESTONE_SESSIONS',
          threshold: { kind: 'MILESTONE_SESSIONS', sessions: 3 },
        });
      expect(milestoneRes.status).toBe(201);
      milestone3BadgeId = milestoneRes.body.id;
      badgeDefIds.push(milestone3BadgeId);

      const streakRes = await as(ownerToken)
        .post(`/gamification/studio/${ZEN}/badge-definitions`)
        .send({
          key: 'e2e-streak-3',
          name: 'E2E: 3 haftalik seri',
          kind: 'STREAK_WEEKS',
          threshold: { kind: 'STREAK_WEEKS', weeks: 3, minSessionsPerWeek: 1 },
        });
      expect(streakRes.status).toBe(201);
      streak3BadgeId = streakRes.body.id;
      badgeDefIds.push(streak3BadgeId);
    });

    it('rejects a threshold whose kind does not match the badge kind', async () => {
      const res = await as(ownerToken)
        .post(`/gamification/studio/${ZEN}/badge-definitions`)
        .send({ key: 'e2e-mismatch', name: 'Mismatch', kind: 'MILESTONE_SESSIONS', threshold: { kind: 'FIRST_SESSION' } });
      expect(res.status).toBe(400);
    });

    it('staff can list global defaults plus the studio own badges', async () => {
      const res = await as(ownerToken).get(`/gamification/studio/${ZEN}/badge-definitions`);
      expect(res.status).toBe(200);
      const keys = res.body.map((b: any) => b.key);
      expect(keys).toEqual(expect.arrayContaining(['first-session', 'milestone-1', 'e2e-milestone-3', 'e2e-streak-3']));
    });

    it('cannot update a global (studioId null) badge definition', async () => {
      const global = await prisma.badgeDefinition.findFirstOrThrow({ where: { studioId: null, key: 'first-session' } });
      const res = await as(ownerToken).put(`/gamification/studio/${ZEN}/badge-definitions/${global.id}`).send({ name: 'Yeni ad' });
      expect(res.status).toBe(404);
    });

    it('updates the studio own badge and rejects deleting it once earned (checked later)', async () => {
      const res = await as(ownerToken).put(`/gamification/studio/${ZEN}/badge-definitions/${milestone3BadgeId}`).send({ name: 'E2E: uc seans' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('E2E: uc seans');
    });

    it('deletes an unearned badge definition', async () => {
      const throwaway = await as(ownerToken)
        .post(`/gamification/studio/${ZEN}/badge-definitions`)
        .send({ key: 'e2e-throwaway', name: 'Throwaway', kind: 'FIRST_SESSION', threshold: { kind: 'FIRST_SESSION' } });
      expect(throwaway.status).toBe(201);
      const del = await as(ownerToken).delete(`/gamification/studio/${ZEN}/badge-definitions/${throwaway.body.id}`);
      expect(del.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Check-in awards the first-session badge exactly once
  // ---------------------------------------------------------------------------

  describe('check-in triggers evaluation', () => {
    it('member starts with no earned badges', async () => {
      const res = await as(memberToken).get(`/gamification/studio/${ZEN}/me/stats`);
      expect(res.status).toBe(200);
      expect(res.body.earnedBadges).toEqual([]);
      expect(res.body.totalAttendedSessions).toBe(0);
    });

    it('checking in awards the first-session badge', async () => {
      const bookingId = await makeConfirmedBooking(demoMemberId, new Date());
      const checkInRes = await as(ownerToken).patch(`/schedules/check-in/${bookingId}`);
      expect(checkInRes.status).toBe(200);

      const stats = await as(memberToken).get(`/gamification/studio/${ZEN}/me/stats`);
      expect(stats.status).toBe(200);
      expect(stats.body.totalAttendedSessions).toBe(1);
      const firstSession = stats.body.earnedBadges.filter((b: any) => b.key === 'first-session');
      expect(firstSession).toHaveLength(1);
    });

    it('a second check-in does not award the first-session badge again', async () => {
      const bookingId = await makeConfirmedBooking(demoMemberId, new Date());
      const checkInRes = await as(ownerToken).patch(`/schedules/check-in/${bookingId}`);
      expect(checkInRes.status).toBe(200);

      const stats = await as(memberToken).get(`/gamification/studio/${ZEN}/me/stats`);
      expect(stats.body.totalAttendedSessions).toBe(2);
      const firstSession = stats.body.earnedBadges.filter((b: any) => b.key === 'first-session');
      expect(firstSession).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Milestone + streak, from fixtures with past dates, evaluated via backfill
  // ---------------------------------------------------------------------------

  describe('milestone and streak from past fixtures (backfill)', () => {
    it('three past sessions in three consecutive weeks award the milestone and streak badges', async () => {
      const now = Date.now();
      // Three distinct weeks, far enough in the past to never merge with the
      // current week's two check-ins above (avoids depending on "today").
      await makeAttendedFixture(demoMemberId, new Date(now - 10 * WEEK));
      await makeAttendedFixture(demoMemberId, new Date(now - 9 * WEEK));
      await makeAttendedFixture(demoMemberId, new Date(now - 8 * WEEK));

      const backfillRes = await as(ownerToken).post(`/gamification/studio/${ZEN}/backfill`);
      expect(backfillRes.status).toBe(201);
      expect(backfillRes.body.membersEvaluated).toBeGreaterThan(0);

      const stats = await as(memberToken).get(`/gamification/studio/${ZEN}/me/stats`);
      expect(stats.body.totalAttendedSessions).toBe(5);
      expect(stats.body.bestStreakWeeks).toBeGreaterThanOrEqual(3);

      const keys = stats.body.earnedBadges.map((b: any) => b.key);
      expect(keys).toEqual(expect.arrayContaining(['e2e-milestone-3', 'e2e-streak-3']));
    });

    it('now refuses to delete the earned milestone badge definition', async () => {
      const res = await as(ownerToken).delete(`/gamification/studio/${ZEN}/badge-definitions/${milestone3BadgeId}`);
      expect(res.status).toBe(409);
    });

    it('staff achievements view lists the member with their badge count', async () => {
      const res = await as(ownerToken).get(`/gamification/studio/${ZEN}/achievements`);
      expect(res.status).toBe(200);
      const entry = res.body.find((a: any) => a.memberId === demoMemberId);
      expect(entry).toBeTruthy();
      expect(entry.totalAttendedSessions).toBe(5);
      expect(entry.badgeCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Monthly goal progress
  // ---------------------------------------------------------------------------

  describe('monthly goal', () => {
    it('progress reflects sessions attended this month; met once the target is reached', async () => {
      const month = currentMonthKey();
      goalMonths.push({ memberId: demoMemberId, month });

      const notMet = await as(memberToken).put(`/gamification/studio/${ZEN}/me/goal`).send({ month, targetSessions: 100 });
      expect(notMet.status).toBe(200);
      expect(notMet.body.currentMonth.progress).toBe(2); // the two "now" check-ins; past fixtures are 8-10 weeks back
      expect(notMet.body.currentMonth.metGoal).toBe(false);

      const met = await as(memberToken).put(`/gamification/studio/${ZEN}/me/goal`).send({ month, targetSessions: 2 });
      expect(met.status).toBe(200);
      expect(met.body.currentMonth.metGoal).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Leaderboard: opt-in privacy and name masking
  // ---------------------------------------------------------------------------

  describe('leaderboard', () => {
    let memberAFirstName: string;
    let memberBFirstName: string;

    beforeAll(async () => {
      const a = await prisma.memberProfile.findUniqueOrThrow({ where: { id: memberAId }, include: { membership: { include: { user: true } } } });
      const b = await prisma.memberProfile.findUniqueOrThrow({ where: { id: memberBId }, include: { membership: { include: { user: true } } } });
      memberAFirstName = a.membership.user.firstName;
      memberBFirstName = b.membership.user.firstName;

      const now = new Date();
      await makeAttendedFixture(memberAId, now);
      await makeAttendedFixture(memberAId, new Date(now.getTime() - HOUR));
      await makeAttendedFixture(memberAId, new Date(now.getTime() - 2 * HOUR));
      // Member B has MORE sessions than A but stays opted out -> must never appear.
      await makeAttendedFixture(memberBId, now);
      await makeAttendedFixture(memberBId, new Date(now.getTime() - HOUR));
      await makeAttendedFixture(memberBId, new Date(now.getTime() - 2 * HOUR));
      await makeAttendedFixture(memberBId, new Date(now.getTime() - 3 * HOUR));

      const optInA = await as(memberAToken).put(`/gamification/studio/${ZEN}/me/leaderboard-opt-in`).send({ optedIn: true });
      expect(optInA.status).toBe(200);
      const optInSelf = await as(memberToken).put(`/gamification/studio/${ZEN}/me/leaderboard-opt-in`).send({ optedIn: true });
      expect(optInSelf.status).toBe(200);
      // Member B deliberately never opts in.
    });

    it('only opted-in members appear, ranked by sessions, with masked names', async () => {
      const res = await as(memberToken).get(`/gamification/studio/${ZEN}/leaderboard?month=${currentMonthKey()}`);
      expect(res.status).toBe(200);
      const names = res.body.entries.map((e: any) => e.displayName);

      expect(names.some((n: string) => n.startsWith(`${memberAFirstName} `) && / [A-ZÇĞİÖŞÜ]\.$/.test(n))).toBe(true);
      expect(names.some((n: string) => n.startsWith(`${memberBFirstName} `))).toBe(false); // opted out, hidden

      const selfEntry = res.body.entries.find((e: any) => e.isSelf);
      expect(selfEntry).toBeTruthy();
      expect(selfEntry.sessions).toBe(2);

      const aEntry = res.body.entries.find((e: any) => e.displayName.startsWith(`${memberAFirstName} `));
      expect(aEntry.sessions).toBe(3);
      expect(aEntry.rank).toBeLessThan(selfEntry.rank); // A has more sessions this month
    });
  });

  // ---------------------------------------------------------------------------
  // Disabled gamification awards nothing
  // ---------------------------------------------------------------------------

  describe('disabled gamification', () => {
    it('turning gamification off stops new badges from being awarded', async () => {
      const off = await as(ownerToken).put(`/gamification/studio/${ZEN}/settings`).send({ enabled: false });
      expect(off.status).toBe(200);
      expect(off.body.enabled).toBe(false);

      const bookingId = await makeConfirmedBooking(memberCId, new Date());
      const checkInRes = await as(ownerToken).patch(`/schedules/check-in/${bookingId}`);
      expect(checkInRes.status).toBe(200); // check-in itself must never fail

      const stats = await as(memberCToken).get(`/gamification/studio/${ZEN}/me/stats`);
      expect(stats.status).toBe(200);
      expect(stats.body.totalAttendedSessions).toBe(1); // attendance is still recorded
      expect(stats.body.earnedBadges).toEqual([]); // but nothing was awarded

      const on = await as(ownerToken).put(`/gamification/studio/${ZEN}/settings`).send({ enabled: true });
      expect(on.status).toBe(200);
      expect(on.body.enabled).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Permission and cross-tenant denials
  // ---------------------------------------------------------------------------

  describe('permission and cross-tenant denials', () => {
    it('a member cannot view the staff achievements list', async () => {
      const res = await as(memberToken).get(`/gamification/studio/${ZEN}/achievements`);
      expect(res.status).toBe(403);
    });

    it('a member cannot trigger a backfill', async () => {
      const res = await as(memberToken).post(`/gamification/studio/${ZEN}/backfill`);
      expect(res.status).toBe(403);
    });

    it('a member cannot change the gamification setting', async () => {
      const res = await as(memberToken).put(`/gamification/studio/${ZEN}/settings`).send({ enabled: false });
      expect(res.status).toBe(403);
    });

    it('the Zen owner has no access to Flow gamification data (cross-tenant)', async () => {
      const res = await as(ownerToken, FLOW).get(`/gamification/studio/${FLOW}/me/stats`);
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request is rejected', async () => {
      const res = await request(server).get(`/gamification/studio/${ZEN}/me/stats`).set('x-studio-id', ZEN);
      expect(res.status).toBe(401);
    });
  });
});
