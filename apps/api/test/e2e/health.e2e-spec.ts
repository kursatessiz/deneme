import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W21: Apple Health / Android Health Connect integration. Health data is
 * special-category personal data under KVKK, so most of this suite exercises
 * the privacy gates: no upload without an active HEALTH_DATA consent, no
 * server storage without the member's own separate opt-ins, staff can only
 * see what the member chose to share and only within their branch.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';
const HOUR = 3_600_000;

describe('Health integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let mainBranch: string;
  let secondBranch: string;
  let serviceTypeId: string;
  let trainerMembershipId: string;

  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let memberId: string;

  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const makeAttendedFixture = async (forMemberId: string, startTime: Date) => {
    const schedule = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId: mainBranch,
        serviceTypeId,
        title: 'E2E saglik entegrasyonu seansi',
        startTime,
        endTime: new Date(startTime.getTime() + HOUR),
        capacity: 6,
      },
    });
    scheduleIds.push(schedule.id);
    const booking = await prisma.booking.create({
      data: { studioId: ZEN, scheduleId: schedule.id, memberId: forMemberId, status: 'ATTENDED', unitsCharged: 0, checkInAt: startTime },
    });
    bookingIds.push(booking.id);
    return booking.id;
  };

  const resetMemberHealthState = async () => {
    await prisma.healthDailySummary.deleteMany({ where: { memberId } });
    await prisma.healthSyncRecord.deleteMany({ where: { memberId } });
    await prisma.memberHealthSettings.deleteMany({ where: { memberId } });
    const membership = await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: MEMBER_PHONE } } });
    const healthDoc = await prisma.documentVersion.findFirstOrThrow({ where: { type: 'HEALTH_DATA' } });
    await prisma.consent.deleteMany({ where: { membershipId: membership.id, documentVersionId: healthDoc.id } });
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
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, isActive: true } })).id;
    trainerMembershipId = (await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: TRAINER_PHONE } } })).id;

    const member = await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } } });
    memberId = member.id;
    // The member's home branch must be the main branch for the
    // branch-restriction test later to be meaningful.
    await prisma.memberProfile.update({ where: { id: memberId }, data: { homeBranchId: mainBranch } });

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);

    await resetMemberHealthState();
  });

  afterAll(async () => {
    await resetMemberHealthState();
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    // Restore any branch restriction placed on the trainer during this suite.
    await prisma.membershipBranch.deleteMany({ where: { membershipId: trainerMembershipId } });
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Settings default to fully off
  // ---------------------------------------------------------------------------

  it('settings default to every toggle off and no active consent', async () => {
    const res = await as(memberToken).get('/me/health/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ writeWorkouts: false, readAggregates: false, shareWithStudio: false, hasActiveConsent: false });
  });

  // ---------------------------------------------------------------------------
  // Consent gate: nothing can be turned on, and nothing can be uploaded,
  // without an active HEALTH_DATA consent
  // ---------------------------------------------------------------------------

  describe('consent gate', () => {
    it('enabling any toggle without consent is refused', async () => {
      const res = await as(memberToken)
        .put('/me/health/settings')
        .send({ writeWorkouts: true, readAggregates: false, shareWithStudio: false });
      expect(res.status).toBe(403);
    });

    it('uploading a summary without consent is refused (403)', async () => {
      const res = await as(memberToken)
        .post('/me/health/summaries')
        .send({ summaries: [{ date: '2026-09-01', steps: 5000 }] });
      expect(res.status).toBe(403);
    });

    it('accepts the health data consent', async () => {
      const status = await as(memberToken).get('/me/health/consent');
      expect(status.status).toBe(200);
      expect(status.body.hasActiveConsent).toBe(false);
      expect(status.body.documentVersionId).toBeTruthy();

      const accept = await as(memberToken).post('/me/health/consent').send({ device: 'iPhone 15' });
      expect(accept.status).toBe(201);
      expect(accept.body.hasActiveConsent).toBe(true);

      const after = await as(memberToken).get('/me/health/consent');
      expect(after.body.hasActiveConsent).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Settings toggles, now that consent is on file
  // ---------------------------------------------------------------------------

  describe('settings toggles', () => {
    it('turns on write, read and share', async () => {
      const res = await as(memberToken)
        .put('/me/health/settings')
        .send({ writeWorkouts: true, readAggregates: true, shareWithStudio: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ writeWorkouts: true, readAggregates: true, shareWithStudio: true, hasActiveConsent: true });
    });

    it('shareWithStudio is forced off when readAggregates is off, since there would be nothing to share', async () => {
      const res = await as(memberToken)
        .put('/me/health/settings')
        .send({ writeWorkouts: true, readAggregates: false, shareWithStudio: true });
      expect(res.status).toBe(200);
      expect(res.body.readAggregates).toBe(false);
      expect(res.body.shareWithStudio).toBe(false);

      // restore for later tests
      const restore = await as(memberToken)
        .put('/me/health/settings')
        .send({ writeWorkouts: true, readAggregates: true, shareWithStudio: true });
      expect(restore.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Daily summary upsert: idempotent and range-validated
  // ---------------------------------------------------------------------------

  describe('daily summary upload', () => {
    it('rejects an out-of-range step count (400)', async () => {
      const res = await as(memberToken)
        .post('/me/health/summaries')
        .send({ summaries: [{ date: '2026-09-01', steps: 200_000 }] });
      expect(res.status).toBe(400);
    });

    it('rejects an out-of-range resting heart rate (400)', async () => {
      const res = await as(memberToken)
        .post('/me/health/summaries')
        .send({ summaries: [{ date: '2026-09-01', restingHeartRate: 300 }] });
      expect(res.status).toBe(400);
    });

    it('rejects a batch larger than 31 days (400)', async () => {
      const summaries = Array.from({ length: 32 }, (_, i) => ({ date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, steps: 1000 }));
      const res = await as(memberToken).post('/me/health/summaries').send({ summaries });
      expect(res.status).toBe(400);
    });

    it('upserts a day and is idempotent when sent again with a different value', async () => {
      const first = await as(memberToken)
        .post('/me/health/summaries')
        .send({ summaries: [{ date: '2026-09-01', steps: 4000, activeEnergyKcal: 250.5, restingHeartRate: 60 }] });
      expect(first.status).toBe(201);
      expect(first.body).toEqual({ upserted: 1 });

      const second = await as(memberToken)
        .post('/me/health/summaries')
        .send({ summaries: [{ date: '2026-09-01', steps: 9000, activeEnergyKcal: 400, restingHeartRate: 65 }] });
      expect(second.status).toBe(201);

      const rows = await prisma.healthDailySummary.findMany({ where: { memberId, date: new Date('2026-09-01') } });
      expect(rows).toHaveLength(1); // never duplicated
      expect(rows[0].steps).toBe(9000); // latest value wins

      const mine = await as(memberToken).get('/me/health/summaries');
      expect(mine.status).toBe(200);
      const day = mine.body.find((s: any) => s.date === '2026-09-01');
      expect(day).toBeTruthy();
      expect(day.steps).toBe(9000);
    });
  });

  // ---------------------------------------------------------------------------
  // Workout write-back sync records: idempotent
  // ---------------------------------------------------------------------------

  describe('sync records', () => {
    it('records a workout sync for an attended booking, idempotently', async () => {
      const bookingId = await makeAttendedFixture(memberId, new Date());

      const first = await as(memberToken).post('/me/health/sync-records').send({ bookingId, platform: 'APPLE_HEALTH' });
      expect(first.status).toBe(201);
      const firstId = first.body.id;

      const second = await as(memberToken).post('/me/health/sync-records').send({ bookingId, platform: 'APPLE_HEALTH' });
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(firstId); // same record, never duplicated

      const rows = await prisma.healthSyncRecord.findMany({ where: { memberId, bookingId } });
      expect(rows).toHaveLength(1);

      const list = await as(memberToken).get('/me/health/sync-records');
      expect(list.status).toBe(200);
      expect(list.body.some((r: any) => r.bookingId === bookingId)).toBe(true);
    });

    it('refuses to sync a booking that is not ATTENDED', async () => {
      const schedule = await prisma.sessionSchedule.create({
        data: {
          studioId: ZEN,
          branchId: mainBranch,
          serviceTypeId,
          title: 'E2E confirmed only',
          startTime: new Date(Date.now() + HOUR),
          endTime: new Date(Date.now() + 2 * HOUR),
          capacity: 6,
        },
      });
      scheduleIds.push(schedule.id);
      const booking = await prisma.booking.create({
        data: { studioId: ZEN, scheduleId: schedule.id, memberId, status: 'CONFIRMED', unitsCharged: 0 },
      });
      bookingIds.push(booking.id);

      const res = await as(memberToken).post('/me/health/sync-records').send({ bookingId: booking.id, platform: 'APPLE_HEALTH' });
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Staff view: permission AND the member's own share toggle, branch-scoped
  // ---------------------------------------------------------------------------

  describe('staff view of a member health trend', () => {
    it('a member (no members.health.view) cannot view the staff endpoint', async () => {
      const res = await as(memberToken).get(`/studios/${ZEN}/members/${memberId}/health`);
      expect(res.status).toBe(403);
    });

    it('a trainer with permission sees the shared trend', async () => {
      const res = await as(trainerToken).get(`/studios/${ZEN}/members/${memberId}/health`);
      expect(res.status).toBe(200);
      expect(res.body.shareWithStudio).toBe(true);
      expect(res.body.summaries.some((s: any) => s.date === '2026-09-01')).toBe(true);
    });

    it('turning shareWithStudio off hides the trend from staff even though data still exists', async () => {
      const off = await as(memberToken)
        .put('/me/health/settings')
        .send({ writeWorkouts: true, readAggregates: true, shareWithStudio: false });
      expect(off.status).toBe(200);

      const res = await as(trainerToken).get(`/studios/${ZEN}/members/${memberId}/health`);
      expect(res.status).toBe(200);
      expect(res.body.shareWithStudio).toBe(false);
      expect(res.body.summaries).toEqual([]);

      // restore for the next tests
      const restore = await as(memberToken)
        .put('/me/health/settings')
        .send({ writeWorkouts: true, readAggregates: true, shareWithStudio: true });
      expect(restore.status).toBe(200);
    });

    it('a branch-restricted trainer is denied for a member in another branch', async () => {
      const restrict = await as(ownerToken).put(`/branches/staff/${trainerMembershipId}`).send({ branchIds: [secondBranch] });
      expect(restrict.status).toBe(200);

      const res = await as(trainerToken).get(`/studios/${ZEN}/members/${memberId}/health`); // member's home branch is mainBranch
      expect(res.status).toBe(403);

      const clear = await as(ownerToken).put(`/branches/staff/${trainerMembershipId}`).send({ branchIds: [] });
      expect(clear.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Delete everything: audited right to erasure
  // ---------------------------------------------------------------------------

  describe('delete all health data', () => {
    it('removes every server-side row, resets settings and is audited', async () => {
      const before = await prisma.auditLog.count({ where: { studioId: ZEN, action: 'member_health.data_deleted' } });

      const res = await as(memberToken).delete('/me/health/data');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });

      const summaries = await prisma.healthDailySummary.count({ where: { memberId } });
      const syncRecords = await prisma.healthSyncRecord.count({ where: { memberId } });
      expect(summaries).toBe(0);
      expect(syncRecords).toBe(0);

      const settings = await as(memberToken).get('/me/health/settings');
      expect(settings.body).toEqual({ writeWorkouts: false, readAggregates: false, shareWithStudio: false, hasActiveConsent: false });

      const after = await prisma.auditLog.count({ where: { studioId: ZEN, action: 'member_health.data_deleted' } });
      expect(after).toBe(before + 1);

      // Consent was revoked too: re-enabling anything now needs a fresh accept.
      const reEnable = await as(memberToken).put('/me/health/settings').send({ writeWorkouts: true, readAggregates: false, shareWithStudio: false });
      expect(reEnable.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-tenant denial
  // ---------------------------------------------------------------------------

  describe('cross-tenant denial', () => {
    it('the Zen owner has no access to Flow via a mismatched studio header', async () => {
      const res = await as(ownerToken, FLOW).get(`/studios/${FLOW}/members/${memberId}/health`);
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request is rejected', async () => {
      const res = await request(server).get('/me/health/settings').set('x-studio-id', ZEN);
      expect(res.status).toBe(401);
    });
  });
});
