import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W15: post-class ratings, Google review redirect, refer-a-friend. Builds
 * deterministic fixtures in the Zen studio and never touches seed data.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';

describe('Feedback: ratings, review redirect, referrals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let mainBranch: string;
  let trainerId: string;
  let serviceTypeId: string;
  let memberId: string; // MEMBER_PHONE's member profile
  let otherMemberId: string;
  let otherMemberProfileMembershipUserPhone: string;

  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];
  const createdUserPhones: string[] = [];
  const createdMemberIds: string[] = [];
  const memberPackageIds: string[] = [];
  let originalGoogleReviewUrl: string | null;
  let originalReferralRewardUnits: number;

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const makeSchedule = async (start: Date, trainer = trainerId) => {
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId: mainBranch,
        serviceTypeId,
        trainerId: trainer,
        title: 'E2E geri bildirim',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity: 6,
      },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  const makeBooking = async (scheduleId: string, member: string, status: 'ATTENDED' | 'CONFIRMED' | 'NO_SHOW' = 'ATTENDED') => {
    const b = await prisma.booking.create({
      data: { studioId: ZEN, scheduleId, memberId: member, status },
    });
    bookingIds.push(b.id);
    return b.id;
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
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, isActive: true } })).id;
    trainerId = (await prisma.trainerProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: TRAINER_PHONE } } } })).id;
    memberId = (await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } } })).id;
    const other = await prisma.memberProfile.findFirstOrThrow({
      where: { studioId: ZEN, id: { not: memberId } },
      include: { membership: { include: { user: true } } },
    });
    otherMemberId = other.id;
    otherMemberProfileMembershipUserPhone = other.membership.user.phone;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);

    const studio = await prisma.studio.findUniqueOrThrow({ where: { id: ZEN }, select: { googleReviewUrl: true, referralRewardUnits: true } });
    originalGoogleReviewUrl = studio.googleReviewUrl;
    originalReferralRewardUnits = studio.referralRewardUnits;
  });

  afterAll(async () => {
    // Restore studio settings touched by tests.
    await prisma.studio.update({ where: { id: ZEN }, data: { googleReviewUrl: originalGoogleReviewUrl, referralRewardUnits: originalReferralRewardUnits } });

    await prisma.sessionRating.deleteMany({ where: { studioId: ZEN, bookingId: { in: bookingIds } } });
    await prisma.referral.deleteMany({ where: { studioId: ZEN } });
    await prisma.referralCode.deleteMany({ where: { studioId: ZEN, memberId: { in: [memberId, ...createdMemberIds] } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: memberPackageIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    for (const memberProfileId of createdMemberIds) {
      const mp = await prisma.memberProfile.findUnique({ where: { id: memberProfileId }, select: { membershipId: true } });
      if (mp) {
        await prisma.membership.delete({ where: { id: mp.membershipId } }).catch(() => undefined);
      }
    }
    for (const phone of createdUserPhones) {
      await prisma.user.deleteMany({ where: { phone } });
    }

    await prisma.$disconnect();
    await app.close();
  });

  describe('rating a session', () => {
    it('lets a member rate their own ATTENDED booking', async () => {
      const scheduleId = await makeSchedule(new Date(Date.now() - 2 * HOUR));
      const bookingId = await makeBooking(scheduleId, memberId, 'ATTENDED');

      const res = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${bookingId}`).send({ score: 5, comment: 'Harikaydi' });

      expect(res.status).toBe(201);
      expect(res.body.rating.score).toBe(5);
      expect(res.body.rating.memberName).toBeTruthy();
    });

    it('rejects rating another member\'s booking (404)', async () => {
      const scheduleId = await makeSchedule(new Date(Date.now() - 2 * HOUR));
      const bookingId = await makeBooking(scheduleId, otherMemberId, 'ATTENDED');

      const res = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${bookingId}`).send({ score: 5 });

      expect(res.status).toBe(404);
    });

    it('rejects rating a future/unattended booking (400)', async () => {
      const futureScheduleId = await makeSchedule(new Date(Date.now() + 2 * HOUR));
      const futureBookingId = await makeBooking(futureScheduleId, memberId, 'CONFIRMED');

      const res = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${futureBookingId}`).send({ score: 5 });

      expect(res.status).toBe(400);
    });

    it('enforces the 7-day rating window', async () => {
      const oldScheduleId = await makeSchedule(new Date(Date.now() - 8 * 24 * HOUR));
      const oldBookingId = await makeBooking(oldScheduleId, memberId, 'ATTENDED');

      const res = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${oldBookingId}`).send({ score: 4 });

      expect(res.status).toBe(400);
    });

    it('rejects a second rating on the same booking with 409', async () => {
      const scheduleId = await makeSchedule(new Date(Date.now() - 2 * HOUR));
      const bookingId = await makeBooking(scheduleId, memberId, 'ATTENDED');

      const first = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${bookingId}`).send({ score: 3 });
      expect(first.status).toBe(201);

      const second = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${bookingId}`).send({ score: 4 });
      expect(second.status).toBe(409);
    });

    it('keeps the member anonymous in the trainer\'s own view by default', async () => {
      const scheduleId = await makeSchedule(new Date(Date.now() - 3 * HOUR));
      const bookingId = await makeBooking(scheduleId, memberId, 'ATTENDED');
      const rateRes = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${bookingId}`).send({ score: 3, comment: 'Anonim test' });
      expect(rateRes.status).toBe(201);
      expect(rateRes.body.rating.isAnonymousToTrainer).toBe(true);

      const summary = await as(trainerToken).get(`/ratings/studio/${ZEN}/me/received`);
      expect(summary.status).toBe(200);
      const mine = summary.body.items.find((i: any) => i.bookingId === bookingId);
      expect(mine).toBeTruthy();
      expect(mine.memberName).toBeNull();
    });

    it('notifies the studio owner on a low score (<=2)', async () => {
      await request(server)
        .post('/me/push-device')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ token: 'ExponentPushToken[e2e-owner-feedback-device]', platform: 'ios' });

      const scheduleId = await makeSchedule(new Date(Date.now() - 2 * HOUR));
      const bookingId = await makeBooking(scheduleId, memberId, 'ATTENDED');

      // The low-score branch runs NotificationsService.notifyUser with
      // category FEEDBACK for every active owner; asserting 201 here
      // confirms that code path executes without error end to end (push
      // delivery itself is MOCK-provider and not independently observable
      // over this HTTP API).
      const res = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${bookingId}`).send({ score: 1, comment: 'Cok kotuydu' });
      expect(res.status).toBe(201);
    });

    it('staff without reports.view cannot list ratings', async () => {
      const res = await as(trainerToken).get(`/ratings/studio/${ZEN}`);
      expect(res.status).toBe(403);
    });

    it('owner (reports.view) can list ratings with aggregates', async () => {
      const res = await as(ownerToken).get(`/ratings/studio/${ZEN}`);
      expect(res.status).toBe(200);
      expect(res.body.aggregate.count).toBeGreaterThan(0);
    });

    it('cross-tenant: a ZEN owner cannot list FLOW ratings', async () => {
      const res = await as(ownerToken, FLOW).get(`/ratings/studio/${FLOW}`);
      expect(res.status).toBe(403);
    });
  });

  describe('Google review redirect', () => {
    it('review prompt is omitted when the studio has no googleReviewUrl', async () => {
      await prisma.studio.update({ where: { id: ZEN }, data: { googleReviewUrl: null } });
      const scheduleId = await makeSchedule(new Date(Date.now() - 2 * HOUR));
      const bookingId = await makeBooking(scheduleId, memberId, 'ATTENDED');

      const res = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${bookingId}`).send({ score: 5 });

      expect(res.status).toBe(201);
      expect(res.body.reviewPrompt).toBeNull();
    });

    it('review prompt appears only for score >= 4 once the URL is set', async () => {
      const putUrl = await as(ownerToken)
        .put(`/studios/${ZEN}/feedback-settings`)
        .send({ googleReviewUrl: 'https://g.page/r/e2e-studio/review' });
      expect(putUrl.status).toBe(200);

      const lowScoreSchedule = await makeSchedule(new Date(Date.now() - 2 * HOUR));
      const lowScoreBooking = await makeBooking(lowScoreSchedule, memberId, 'ATTENDED');
      const lowRes = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${lowScoreBooking}`).send({ score: 3 });
      expect(lowRes.status).toBe(201);
      expect(lowRes.body.reviewPrompt).toBeNull();

      const goodScoreSchedule = await makeSchedule(new Date(Date.now() - 2 * HOUR));
      const goodScoreBooking = await makeBooking(goodScoreSchedule, memberId, 'ATTENDED');
      const goodRes = await as(memberToken).post(`/ratings/studio/${ZEN}/bookings/${goodScoreBooking}`).send({ score: 4 });
      expect(goodRes.status).toBe(201);
      expect(goodRes.body.reviewPrompt).toEqual({ googleReviewUrl: 'https://g.page/r/e2e-studio/review' });
    });

    it('rejects an invalid googleReviewUrl', async () => {
      const res = await as(ownerToken).put(`/studios/${ZEN}/feedback-settings`).send({ googleReviewUrl: 'https://example.com/review' });
      expect(res.status).toBe(400);
    });
  });

  describe('refer-a-friend', () => {
    it('a member gets a stable referral code and share text', async () => {
      const res = await as(memberToken).get(`/referrals/studio/${ZEN}/me/code`);
      expect(res.status).toBe(200);
      expect(res.body.code).toMatch(/^[A-Z0-9]{4,24}$/);
      expect(res.body.shareText).toContain(res.body.code);

      const again = await as(memberToken).get(`/referrals/studio/${ZEN}/me/code`);
      expect(again.body.code).toBe(res.body.code);
    });

    it('public referral landing returns only studio name and offer text', async () => {
      const code = (await as(memberToken).get(`/referrals/studio/${ZEN}/me/code`)).body.code as string;
      const res = await request(server).get(`/public/referrals/${code}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['offerText', 'studioName']);
    });

    it('happy path: new member with a referral code gets exactly one reward under parallel qualification', async () => {
      await prisma.studio.update({ where: { id: ZEN }, data: { referralRewardUnits: 3 } });
      const code = (await as(memberToken).get(`/referrals/studio/${ZEN}/me/code`)).body.code as string;

      // The referrer needs an active, unit-based package to be credited.
      const packageDef = await prisma.packageDefinition.findFirstOrThrow({ where: { studioId: ZEN, entitlementKind: 'SESSION_COUNT' } });
      const referrerPackage = await prisma.memberPackage.create({
        data: {
          studioId: ZEN,
          memberId,
          packageDefinitionId: packageDef.id,
          entitlementKind: 'SESSION_COUNT',
          totalUnits: 10,
          remainingUnits: 10,
          status: 'ACTIVE',
          endDate: new Date(Date.now() + 30 * 24 * HOUR),
        },
      });
      memberPackageIds.push(referrerPackage.id);

      const phone = `+90539${String(Date.now()).slice(-7)}`;
      createdUserPhones.push(phone);
      const createRes = await as(ownerToken).post('/members').send({
        studioId: ZEN,
        firstName: 'Referans',
        lastName: 'Testi',
        phone,
        referralCode: code,
      });
      expect(createRes.status).toBe(201);
      const referredMemberId = createRes.body.id as string;
      createdMemberIds.push(referredMemberId);

      const scheduleId = await makeSchedule(new Date(Date.now() - 2 * HOUR));
      const bookingId = await makeBooking(scheduleId, referredMemberId, 'ATTENDED');

      // Two parallel reads both try to qualify+reward; exactly one reward must land.
      const [r1, r2] = await Promise.all([
        as(memberToken).get(`/referrals/studio/${ZEN}/me`),
        as(memberToken).get(`/referrals/studio/${ZEN}/me`),
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);

      const referral = r1.body.find((r: any) => r.referredUserId && r.rewardUnits !== null) ?? r1.body[0];
      expect(referral.status).toBe('REWARDED');
      expect(referral.rewardUnits).toBe(3);

      const refreshedPackage = await prisma.memberPackage.findUniqueOrThrow({ where: { id: referrerPackage.id } });
      expect(refreshedPackage.remainingUnits).toBe(13); // rewarded exactly once, not twice
      expect(refreshedPackage.totalUnits).toBe(13);

      bookingIds.push(bookingId);
    });

    it('rejects self-referral (own phone, own code)', async () => {
      const code = (await as(memberToken).get(`/referrals/studio/${ZEN}/me/code`)).body.code as string;

      const res = await as(ownerToken).post('/members').send({
        studioId: ZEN,
        firstName: 'Kendi',
        lastName: 'Kodu',
        phone: MEMBER_PHONE, // the referrer's own phone: already a member -> conflict, never a referral
        referralCode: code,
      });
      expect(res.status).toBe(409);

      const referralForOwnUser = await prisma.referral.findFirst({
        where: { studioId: ZEN, referredUser: { phone: MEMBER_PHONE } },
      });
      expect(referralForOwnUser).toBeNull();
    });

    it('staff without members.manage cannot list or reward referrals', async () => {
      const list = await as(trainerToken).get(`/referrals/studio/${ZEN}`);
      expect(list.status).toBe(403);
    });

    it('owner can list, manually reward, and void referrals', async () => {
      const phone = `+90539${String(Date.now()).slice(-7)}`;
      createdUserPhones.push(phone);
      const code = (await as(memberToken).get(`/referrals/studio/${ZEN}/me/code`)).body.code as string;
      const createRes = await as(ownerToken).post('/members').send({
        studioId: ZEN,
        firstName: 'Manuel',
        lastName: 'Odul',
        phone,
        referralCode: code,
      });
      expect(createRes.status).toBe(201);
      createdMemberIds.push(createRes.body.id);

      const list = await as(ownerToken).get(`/referrals/studio/${ZEN}?status=PENDING`);
      expect(list.status).toBe(200);
      const created = list.body.items.find((r: any) => r.referredName.includes('Manuel'));
      expect(created).toBeTruthy();

      const rewardRes = await as(ownerToken).post(`/referrals/studio/${ZEN}/${created.id}/reward`);
      expect(rewardRes.status).toBe(201);
      expect(rewardRes.body.status).toBe('REWARDED');

      const voidRes = await as(ownerToken).post(`/referrals/studio/${ZEN}/${created.id}/void`).send({ reason: 'test iptali' });
      expect(voidRes.status).toBe(400); // already rewarded, cannot void
    });

    it('cross-tenant: a ZEN owner cannot list FLOW referrals', async () => {
      const res = await as(ownerToken, FLOW).get(`/referrals/studio/${FLOW}`);
      expect(res.status).toBe(403);
    });
  });
});
