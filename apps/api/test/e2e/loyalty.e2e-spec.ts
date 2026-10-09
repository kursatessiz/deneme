import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import type { LoyaltySettings } from '@platform/database';
import type { JourneyDefinition } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { LoyaltyEarnService } from '../../src/modules/loyalty/loyalty-earn.service';
import { LoyaltyLedgerService } from '../../src/modules/loyalty/loyalty-ledger.service';
import { CrmHooksService } from '../../src/modules/crm/hooks/crm-hooks.service';
import { ReferralsService } from '../../src/modules/feedback/referrals.service';
import { GamificationService } from '../../src/modules/gamification/gamification.service';
import { PromotionsService } from '../../src/modules/promotions/promotions.service';

/**
 * G3a loyalty points end to end: earning on check-in and payment
 * (idempotent on retries), referral and badge sources without double
 * credit, birthday points, manual adjustments, redemptions and their
 * effects (member-bound promotion code, package units, rollback on a
 * failed effect, 409 on a low balance), FIFO expiry on the heartbeat, the
 * loyalty.pointsBalance segment field, the journey award_points step,
 * tenant isolation and permissions.
 *
 * Every person uses the +90539888 prefix and is removed in afterAll, the
 * seeded Zen rules are switched off for the run and restored afterwards,
 * so the suite passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const PREFIX = '+90539888';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function phone(n: number): string {
  return `${PREFIX}${String(n).padStart(4, '0')}`;
}

interface TestMember {
  userId: string;
  membershipId: string;
  memberId: string;
  phone: string;
}

describe('Loyalty G3a (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];

  let ZEN: string;
  let FLOW: string;
  let currency: string;
  let mainBranch: string;
  let serviceTypeId: string;
  let packageDefId: string;

  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let flowOwnerToken: string;
  let superAdminToken: string;

  let originalSettings: LoyaltySettings | null;
  let seededActiveRuleIds: string[] = [];
  let seededActiveRewardIds: string[] = [];

  const members: Record<string, TestMember> = {};
  const scheduleIds: string[] = [];

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const runScheduler = (now: Date) =>
    request(server).post('/admin/scheduler/run').set('Authorization', `Bearer ${superAdminToken}`).send({ now: now.toISOString() });
  const base = () => `/studios/${ZEN}/loyalty`;

  const balanceOf = async (m: TestMember) => (await prisma.loyaltyAccount.findUnique({ where: { membershipId: m.membershipId } }))?.balance ?? 0;
  const rowsOf = (m: TestMember, reason?: string) =>
    prisma.loyaltyLedger.findMany({ where: { membershipId: m.membershipId, ...(reason ? { reason } : {}) }, orderBy: { createdAt: 'asc' } });

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { phone: { startsWith: PREFIX } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    const profiles = await prisma.memberProfile.findMany({ where: { membership: { userId: { in: userIds } } }, select: { id: true } });
    const profileIds = profiles.map((p) => p.id);
    const contacts = await prisma.contact.findMany({ where: { phone: { startsWith: PREFIX } }, select: { id: true } });
    const contactIds = contacts.map((c) => c.id);
    await prisma.journey.deleteMany({ where: { studioId: ZEN, name: { startsWith: 'E2E G3A' } } });
    await prisma.segment.deleteMany({ where: { studioId: { in: [ZEN, FLOW] }, name: { startsWith: 'E2E G3A' } } });
    await prisma.loyaltyRule.deleteMany({ where: { studioId: ZEN, name: { startsWith: 'E2E G3A' } } });
    await prisma.promoCode.deleteMany({ where: { restrictedToUserId: { in: userIds } } });
    await prisma.loyaltyRedemption.deleteMany({ where: { membership: { userId: { in: userIds } } } });
    await prisma.loyaltyReward.deleteMany({ where: { studioId: ZEN, name: { startsWith: 'E2E G3A' } } });
    await prisma.notificationLog.deleteMany({ where: { OR: [{ contactId: { in: contactIds } }, { recipientPhone: { startsWith: PREFIX } }] } });
    await prisma.contactTask.deleteMany({ where: { contactId: { in: contactIds } } });
    await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.payment.deleteMany({ where: { memberId: { in: profileIds } } });
    await prisma.booking.deleteMany({ where: { memberId: { in: profileIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { studioId: ZEN, title: 'E2E G3A seans' } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  async function makeMember(key: string, n: number, studioId: string, extra: { birthDate?: Date } = {}): Promise<TestMember> {
    const role = await prisma.roleTemplate.findFirstOrThrow({ where: { studioId, key: 'member' } });
    const template = await prisma.user.findFirstOrThrow({ where: { phone: '+905321000016' }, select: { passwordHash: true } });
    const user = await prisma.user.create({
      data: { phone: phone(n), firstName: `G3a${key}`, lastName: 'E2E', passwordHash: template.passwordHash, phoneVerifiedAt: new Date() },
    });
    const membership = await prisma.membership.create({
      data: { userId: user.id, studioId, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    const profile = await prisma.memberProfile.create({ data: { membershipId: membership.id, studioId, birthDate: extra.birthDate ?? null } });
    const member = { userId: user.id, membershipId: membership.id, memberId: profile.id, phone: phone(n) };
    members[key] = member;
    return member;
  }

  async function confirmedBooking(m: TestMember, startTime: Date): Promise<string> {
    const schedule = await prisma.sessionSchedule.create({
      data: { studioId: ZEN, branchId: mainBranch, serviceTypeId, title: 'E2E G3A seans', startTime, endTime: new Date(startTime.getTime() + HOUR), capacity: 6 },
    });
    scheduleIds.push(schedule.id);
    const booking = await prisma.booking.create({ data: { studioId: ZEN, scheduleId: schedule.id, memberId: m.memberId, status: 'CONFIRMED', unitsCharged: 0 } });
    return booking.id;
  }

  async function sell(m: TestMember, paidAmount: number) {
    const res = await as(ownerToken, ZEN)
      .post('/members/packages/assign')
      .send({ studioId: ZEN, memberId: m.memberId, packageDefinitionId: packageDefId, paymentMethod: 'CASH', paidAmount });
    expect(res.status).toBe(201);
    const payment = await prisma.payment.findFirstOrThrow({ where: { memberPackageId: res.body.id } });
    return { memberPackageId: res.body.id as string, paymentId: payment.id };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = zen.id;
    currency = zen.currency;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    mainBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN, name: 'Nisantasi Merkez Sube' } })).id;
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN } })).id;
    packageDefId = (await prisma.packageDefinition.findFirstOrThrow({ where: { studioId: ZEN, entitlementKind: 'SESSION_COUNT', isTrial: false } })).id;

    ownerToken = await login('+905321000002');
    receptionToken = await login('+905321000003');
    trainerToken = await login('+905321000004');
    flowOwnerToken = await login('+905321000022');
    superAdminToken = await login('+905321000001');

    await cleanup();
    originalSettings = await prisma.loyaltySettings.findUnique({ where: { studioId: ZEN } });
    seededActiveRuleIds = (await prisma.loyaltyRule.findMany({ where: { studioId: ZEN, isActive: true }, select: { id: true } })).map((r) => r.id);
    seededActiveRewardIds = (await prisma.loyaltyReward.findMany({ where: { studioId: ZEN, isActive: true }, select: { id: true } })).map((r) => r.id);
    await prisma.loyaltyRule.updateMany({ where: { id: { in: seededActiveRuleIds } }, data: { isActive: false } });
    await prisma.loyaltyReward.updateMany({ where: { id: { in: seededActiveRewardIds } }, data: { isActive: false } });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.loyaltyRule.updateMany({ where: { id: { in: seededActiveRuleIds } }, data: { isActive: true } });
    await prisma.loyaltyReward.updateMany({ where: { id: { in: seededActiveRewardIds } }, data: { isActive: true } });
    if (originalSettings) {
      const { studioId, createdAt, updatedAt, ...rest } = originalSettings;
      void createdAt;
      void updatedAt;
      await prisma.loyaltySettings.update({ where: { studioId }, data: rest });
    } else {
      await prisma.loyaltySettings.deleteMany({ where: { studioId: ZEN } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------

  describe('settings and rules', () => {
    it('configures the program and validates rules against the studio currency', async () => {
      const settings = await as(ownerToken, ZEN).put(`${base()}/settings`).send({ enabled: true, expiryMode: 'NONE', memberRedeemEnabled: true, expiryNoticeDays: 14 });
      expect(settings.status).toBe(200);
      expect(settings.body).toMatchObject({ enabled: true, expiryMode: 'NONE', expiryMonths: null, memberRedeemEnabled: true, currency });

      const other = currency === 'USD' ? 'EUR' : 'USD';
      const wrong = await as(ownerToken, ZEN)
        .post(`${base()}/rules`)
        .send({ kind: 'PURCHASE_AMOUNT', name: 'E2E G3A yanlis', points: 1, perAmount: 10, currency: other });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('LOYALTY_CURRENCY_MISMATCH');
      const missing = await as(ownerToken, ZEN).post(`${base()}/rules`).send({ kind: 'PURCHASE_AMOUNT', name: 'E2E G3A eksik', points: 1 });
      expect(missing.status).toBe(400);

      const rules = [
        { kind: 'ATTENDANCE', name: 'E2E G3A katilim', points: 15 },
        { kind: 'ATTENDANCE', name: 'E2E G3A baska hizmet', points: 99, conditions: { serviceTypeIds: ['00000000-0000-4000-8000-000000000000'] } },
        { kind: 'PURCHASE_AMOUNT', name: 'E2E G3A satin alma', points: 2, perAmount: 50, currency },
        { kind: 'REFERRAL', name: 'E2E G3A tavsiye', points: 100 },
        { kind: 'BADGE', name: 'E2E G3A rozet', points: 20 },
        { kind: 'BIRTHDAY', name: 'E2E G3A dogum gunu', points: 40 },
        { kind: 'MANUAL', name: 'E2E G3A yorum', points: 30 },
      ];
      for (const rule of rules) {
        const res = await as(ownerToken, ZEN).post(`${base()}/rules`).send(rule);
        expect(res.status).toBe(201);
      }
      const list = await as(receptionToken, ZEN).get(`${base()}/rules`);
      expect(list.status).toBe(200);
      expect(list.body.items.filter((r: { name: string; isActive: boolean }) => r.name.startsWith('E2E G3A') && r.isActive)).toHaveLength(rules.length);
    });
  });

  // ---------------------------------------------------------------------------

  describe('earning', () => {
    it('earns on check-in once, however often the hook runs', async () => {
      const a = await makeMember('attend', 1, ZEN);
      const bookingId = await confirmedBooking(a, new Date(Date.now() - HOUR));
      const res = await as(ownerToken, ZEN).patch(`/schedules/check-in/${bookingId}`);
      expect(res.status).toBe(200);

      const earned = await rowsOf(a, 'EARN_ATTENDANCE');
      expect(earned).toHaveLength(1);
      // Only the rule without a service condition applies.
      expect(earned[0]).toMatchObject({ delta: 15, sourceType: 'booking', sourceId: bookingId });

      expect(await app.get(LoyaltyEarnService).onAttendance(ZEN, bookingId)).toBe(0);
      await app.get(CrmHooksService).onBookingAttended(ZEN, bookingId);
      expect(await rowsOf(a, 'EARN_ATTENDANCE')).toHaveLength(1);
      // A second check-in of the same booking is refused and earns nothing.
      expect((await as(ownerToken, ZEN).patch(`/schedules/check-in/${bookingId}`)).status).toBe(400);
      expect(await rowsOf(a, 'EARN_ATTENDANCE')).toHaveLength(1);
    });

    it('turns badges into points once per badge', async () => {
      const a = members.attend;
      const badges = await prisma.memberBadge.findMany({ where: { memberId: a.memberId } });
      // The seeded global first-session badge is earned by the first check-in.
      expect(badges.length).toBeGreaterThan(0);
      const badgeRows = await rowsOf(a, 'EARN_BADGE');
      expect(badgeRows).toHaveLength(badges.length);
      expect(badgeRows.every((r) => r.delta === 20)).toBe(true);
      expect(await app.get(LoyaltyEarnService).onBadgeAwarded(ZEN, a.memberId, badges[0].id, badges[0].badgeDefinitionId)).toBe(0);
      const owner = { studioId: ZEN } as Parameters<GamificationService['backfill']>[0];
      await app.get(GamificationService).backfill(owner);
      expect(await rowsOf(a, 'EARN_BADGE')).toHaveLength(badges.length);
    });

    it('earns per whole amount of a payment in the studio currency, once', async () => {
      const a = members.attend;
      const { paymentId } = await sell(a, 275);
      const rows = await rowsOf(a, 'EARN_PURCHASE');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ delta: 10, sourceType: 'payment', sourceId: paymentId });
      expect(await app.get(LoyaltyEarnService).onPayment(ZEN, paymentId)).toBe(0);
      await app.get(CrmHooksService).onPaymentCompleted(ZEN, paymentId);
      expect(await rowsOf(a, 'EARN_PURCHASE')).toHaveLength(1);
      const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { membershipId: a.membershipId } });
      const sum = (await rowsOf(a)).reduce((s, r) => s + r.delta, 0);
      expect(account.balance).toBe(sum);
      expect(account.lifetimeEarned).toBe(sum);
    });

    it('credits the referrer once when the referral is rewarded, next to the package units', async () => {
      const referrer = await makeMember('referrer', 2, ZEN);
      const referred = await makeMember('referred', 3, ZEN);
      const bookingId = await confirmedBooking(referred, new Date(Date.now() - 2 * HOUR));
      await prisma.booking.update({ where: { id: bookingId }, data: { status: 'ATTENDED', checkInAt: new Date() } });
      const referral = await prisma.referral.create({
        data: { studioId: ZEN, referrerMemberId: referrer.memberId, referredUserId: referred.userId, referredPhone: referred.phone, status: 'PENDING' },
      });
      const referrals = app.get(ReferralsService);
      await referrals.recompute(ZEN, [referral.id]);
      await referrals.recompute(ZEN, [referral.id]);
      expect((await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } })).status).toBe('REWARDED');
      const rows = await rowsOf(referrer, 'EARN_REFERRAL');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ delta: 100, sourceId: referral.id });
      const manual = await as(ownerToken, ZEN).post(`/referrals/studio/${ZEN}/${referral.id}/reward`);
      expect(manual.status).toBe(409);
      const again = await prisma.$transaction((tx) => app.get(LoyaltyEarnService).onReferralRewardedTx(tx, ZEN, referral.id, referrer.memberId));
      expect(again).toBe(0);
      expect(await rowsOf(referrer, 'EARN_REFERRAL')).toHaveLength(1);
    });

    it('gives birthday points once per year on the heartbeat', async () => {
      const zen = await prisma.studio.findUniqueOrThrow({ where: { id: ZEN }, select: { timezone: true } });
      const now = new Date();
      const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: zen.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number);
      void y;
      const birthday = await makeMember('birthday', 4, ZEN, { birthDate: new Date(Date.UTC(1990, m - 1, d)) });
      expect((await runScheduler(now)).status).toBe(201);
      expect((await runScheduler(new Date(now.getTime() + 60_000))).status).toBe(201);
      const rows = await rowsOf(birthday, 'EARN_BIRTHDAY');
      expect(rows).toHaveLength(1);
      expect(rows[0].delta).toBe(40);
    });
  });

  // ---------------------------------------------------------------------------

  let percentRewardId: string;
  let creditRewardId: string;
  let giftRewardId: string;
  let expensiveRewardId: string;

  describe('adjustments and redemptions', () => {
    it('adjusts by hand once per idempotency key and never below zero', async () => {
      const b = await makeMember('redeem', 5, ZEN);
      const body = { points: 500, note: 'E2E G3A acilis', idempotencyKey: 'e2e-g3a-open-1' };
      const first = await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/adjust`).send(body);
      expect(first.status).toBe(201);
      expect(first.body.balance).toBe(500);
      const retry = await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/adjust`).send(body);
      expect(retry.status).toBe(201);
      expect(retry.body.balance).toBe(500);
      expect(await rowsOf(b, 'MANUAL_ADJUST')).toHaveLength(1);

      const tooMuch = await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/adjust`).send({ points: -501, note: 'fazla' });
      expect(tooMuch.status).toBe(409);
      expect(tooMuch.body.code).toBe('LOYALTY_INSUFFICIENT_BALANCE');
      expect((await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/adjust`).send({ points: 0, note: 'x' })).status).toBe(400);
      expect(await balanceOf(b)).toBe(500);
    });

    it('creates rewards and validates them', async () => {
      const make = async (body: Record<string, unknown>) => {
        const res = await as(ownerToken, ZEN).post(`${base()}/rewards`).send(body);
        expect(res.status).toBe(201);
        return res.body.id as string;
      };
      expect((await as(ownerToken, ZEN).post(`${base()}/rewards`).send({ type: 'DISCOUNT_PERCENT', name: 'E2E G3A kotu', costPoints: 10, value: 150 })).status).toBe(400);
      expect((await as(ownerToken, ZEN).post(`${base()}/rewards`).send({ type: 'DISCOUNT_AMOUNT', name: 'E2E G3A kotu', costPoints: 10, value: 5 })).status).toBe(400);
      percentRewardId = await make({ type: 'DISCOUNT_PERCENT', name: 'E2E G3A yuzde', costPoints: 200, value: 10 });
      creditRewardId = await make({ type: 'EXTRA_SESSION_CREDIT', name: 'E2E G3A seans', costPoints: 150, value: 1 });
      giftRewardId = await make({ type: 'GIFT', name: 'E2E G3A hediye', costPoints: 20 });
      expensiveRewardId = await make({ type: 'DISCOUNT_AMOUNT', name: 'E2E G3A pahali', costPoints: 100000, value: 50, currency });
    });

    it('refuses a reward the balance cannot cover with 409 and writes nothing', async () => {
      const b = members.redeem;
      const res = await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/redeem`).send({ rewardId: expensiveRewardId });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('LOYALTY_INSUFFICIENT_BALANCE');
      expect(await rowsOf(b, 'REDEEM')).toHaveLength(0);
      expect(await balanceOf(b)).toBe(500);
    });

    it('issues a single-use promotion code only this member can use', async () => {
      const b = members.redeem;
      const res = await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/redeem`).send({ rewardId: percentRewardId });
      expect(res.status).toBe(201);
      expect(res.body.balance).toBe(300);
      expect(res.body.redemption).toMatchObject({ type: 'DISCOUNT_PERCENT', pointsSpent: 200 });
      const code = res.body.redemption.promoCode as string;
      expect(code).toMatch(/^LOY-/);
      const promo = await prisma.promoCode.findFirstOrThrow({ where: { studioId: ZEN, code } });
      expect(promo).toMatchObject({ kind: 'PERCENT', maxRedemptions: 1, perUserLimit: 1, restrictedToUserId: b.userId });

      const promotions = app.get(PromotionsService);
      const pkgDef = await prisma.packageDefinition.findUniqueOrThrow({ where: { id: packageDefId } });
      const priced = await promotions.previewSalePricing(ZEN, b.userId, pkgDef, pkgDef.price, { promoCode: code });
      expect(Number(priced.discountAmount)).toBeGreaterThan(0);
      const stranger = members.attend;
      await expect(promotions.previewSalePricing(ZEN, stranger.userId, pkgDef, pkgDef.price, { promoCode: code })).rejects.toThrow();
    });

    it('rolls the debit back when the package credit has no package, then credits one', async () => {
      const b = members.redeem;
      const none = await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/redeem`).send({ rewardId: creditRewardId });
      expect(none.status).toBe(409);
      expect(none.body.code).toBe('LOYALTY_NO_ACTIVE_PACKAGE');
      expect(await balanceOf(b)).toBe(300);

      // An expired package must not receive the credit either.
      const expired = await prisma.memberPackage.create({
        data: {
          studioId: ZEN,
          memberId: b.memberId,
          packageDefinitionId: packageDefId,
          entitlementKind: 'SESSION_COUNT',
          totalUnits: 5,
          usedUnits: 0,
          remainingUnits: 5,
          status: 'ACTIVE',
          startDate: new Date(Date.now() - 60 * DAY),
          endDate: new Date(Date.now() - DAY),
        },
      });
      try {
        const onExpired = await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/redeem`).send({ rewardId: creditRewardId });
        expect(onExpired.status).toBe(409);
        expect(onExpired.body.code).toBe('LOYALTY_NO_ACTIVE_PACKAGE');
        expect(await balanceOf(b)).toBe(300);
        const untouched = await prisma.memberPackage.findUniqueOrThrow({ where: { id: expired.id } });
        expect(untouched.remainingUnits).toBe(5);
      } finally {
        await prisma.memberPackage.delete({ where: { id: expired.id } });
      }

      const { memberPackageId } = await sell(b, 0);
      const before = await prisma.memberPackage.findUniqueOrThrow({ where: { id: memberPackageId } });
      const ok = await as(receptionToken, ZEN).post(`${base()}/members/${b.memberId}/redeem`).send({ rewardId: creditRewardId });
      expect(ok.status).toBe(201);
      expect(ok.body.redemption.memberPackageId).toBe(memberPackageId);
      const after = await prisma.memberPackage.findUniqueOrThrow({ where: { id: memberPackageId } });
      expect(after.remainingUnits).toBe((before.remainingUnits ?? 0) + 1);
      expect(await balanceOf(b)).toBe(150);
    });

    it('returns the first redemption for a retried request', async () => {
      const b = members.redeem;
      const body = { rewardId: giftRewardId, idempotencyKey: 'e2e-g3a-gift-1' };
      const first = await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/redeem`).send(body);
      const second = await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/redeem`).send(body);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.duplicate).toBe(true);
      expect(second.body.redemption.id).toBe(first.body.redemption.id);
      expect(await balanceOf(b)).toBe(130);
      expect(await prisma.loyaltyRedemption.count({ where: { membershipId: b.membershipId, rewardId: giftRewardId } })).toBe(1);
    });

    it('lets members redeem in the app only when the tenant allows it', async () => {
      const b = members.redeem;
      const memberToken = await login(b.phone);
      const me = await as(memberToken, ZEN).get(`${base()}/me`);
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ balance: 130, memberRedeemEnabled: true, presets: [] });
      expect(me.body.ledger.length).toBeGreaterThan(0);

      const own = await as(memberToken, ZEN).post(`${base()}/me/redeem`).send({ rewardId: giftRewardId });
      expect(own.status).toBe(201);
      expect(own.body.balance).toBe(110);

      await as(ownerToken, ZEN).put(`${base()}/settings`).send({ memberRedeemEnabled: false });
      const blocked = await as(memberToken, ZEN).post(`${base()}/me/redeem`).send({ rewardId: giftRewardId });
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('LOYALTY_MEMBER_REDEEM_DISABLED');
      await as(ownerToken, ZEN).put(`${base()}/settings`).send({ memberRedeemEnabled: true });

      // Members cannot use the staff routes.
      expect((await as(memberToken, ZEN).get(`${base()}/members/${b.memberId}`)).status).toBe(403);
      expect((await as(memberToken, ZEN).post(`${base()}/members/${b.memberId}/adjust`).send({ points: 5, note: 'x' })).status).toBe(403);
    });

    it('shows the balance on the member card and the contact card', async () => {
      const b = members.redeem;
      const card = await as(receptionToken, ZEN).get(`${base()}/members/${b.memberId}`);
      expect(card.status).toBe(200);
      expect(card.body.balance).toBe(110);
      expect(card.body.rewards.find((r: { id: string }) => r.id === percentRewardId)).toMatchObject({ affordable: false });
      expect(card.body.presets.map((p: { name: string }) => p.name)).toContain('E2E G3A yorum');
      const page = await as(receptionToken, ZEN).get(`${base()}/members/${b.memberId}/ledger?page=1&limit=2`);
      expect(page.status).toBe(200);
      expect(page.body.items).toHaveLength(2);

      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, membershipId: b.membershipId } });
      const line = await as(receptionToken, ZEN).get(`${base()}/contacts/${contact.id}/balance`);
      expect(line.status).toBe(200);
      expect(line.body).toMatchObject({ balance: 110, membershipId: b.membershipId });
    });
  });

  // ---------------------------------------------------------------------------

  describe('expiry', () => {
    it('writes off lots FIFO on the heartbeat, once, and notifies before expiry', async () => {
      await as(ownerToken, ZEN).put(`${base()}/settings`).send({ expiryMode: 'MONTHS_AFTER_EARN', expiryMonths: 1, expiryNoticeDays: 14 });
      const c = await makeMember('expiry', 6, ZEN);
      const ledger = app.get(LoyaltyLedgerService);
      const now = new Date();
      const old = await ledger.post({ studioId: ZEN, membershipId: c.membershipId, delta: 100, reason: 'MANUAL_ADJUST', sourceType: 'manual', sourceId: `e2e-${c.membershipId}-1`, now: new Date(now.getTime() - 70 * DAY) });
      const recent = await ledger.post({ studioId: ZEN, membershipId: c.membershipId, delta: 50, reason: 'MANUAL_ADJUST', sourceType: 'manual', sourceId: `e2e-${c.membershipId}-2`, now: new Date(now.getTime() - 20 * DAY) });
      await ledger.post({ studioId: ZEN, membershipId: c.membershipId, delta: -30, reason: 'MANUAL_ADJUST', sourceType: 'manual', sourceId: `e2e-${c.membershipId}-3`, now: new Date(now.getTime() - 15 * DAY) });
      expect(old.entry.expiresAt!.getTime()).toBeLessThan(now.getTime());
      expect(recent.entry.expiresAt!.getTime()).toBeGreaterThan(now.getTime());
      expect(await balanceOf(c)).toBe(120);

      expect((await runScheduler(now)).status).toBe(201);
      expect((await runScheduler(new Date(now.getTime() + 60_000))).status).toBe(201);
      const expired = await rowsOf(c, 'EXPIRED');
      // The debit consumed the oldest lot first: 70 of it is left to expire; the newer lot is untouched.
      expect(expired).toHaveLength(1);
      expect(expired[0]).toMatchObject({ delta: -70, sourceType: 'lot', sourceId: old.entry.id });
      expect(await balanceOf(c)).toBe(50);
      const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { membershipId: c.membershipId } });
      expect(account.nextExpiryAt?.getTime()).toBe(recent.entry.expiresAt!.getTime());
      // The newer lot expires within the notice window: one notice per expiry date.
      expect(account.expiryNoticeFor?.getTime()).toBe(recent.entry.expiresAt!.getTime());

      const later = new Date(recent.entry.expiresAt!.getTime() + HOUR);
      expect((await runScheduler(later)).status).toBe(201);
      const all = await rowsOf(c, 'EXPIRED');
      expect(all).toHaveLength(2);
      expect(all[1]).toMatchObject({ delta: -50, sourceId: recent.entry.id });
      expect(await balanceOf(c)).toBe(0);
      await as(ownerToken, ZEN).put(`${base()}/settings`).send({ expiryMode: 'NONE' });
    });
  });

  // ---------------------------------------------------------------------------

  describe('segments and journeys', () => {
    it('filters contacts by loyalty balance in the tenant only', async () => {
      const b = members.redeem;
      await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/adjust`).send({ points: 77777, note: 'E2E G3A segment' });
      const rules = { combinator: 'and', rules: [{ field: 'loyalty.pointsBalance', op: 'gte', value: 77777 }] };
      const preview = await as(ownerToken, ZEN).post(`/studios/${ZEN}/segments/preview`).send({ rules });
      expect(preview.status).toBe(201);
      expect(preview.body.count).toBe(1);
      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, membershipId: b.membershipId } });
      expect(preview.body.sample[0].id).toBe(contact.id);
      const created = await as(ownerToken, ZEN).post(`/studios/${ZEN}/segments`).send({ name: 'E2E G3A puanli', kind: 'DYNAMIC', rules });
      expect(created.status).toBe(201);
      expect(created.body.cachedCount).toBe(1);

      const flow = await as(flowOwnerToken, FLOW).post(`/studios/${FLOW}/segments/preview`).send({ rules });
      expect(flow.status).toBe(201);
      expect(flow.body.count).toBe(0);
    });

    it('awards points from a journey step once per enrollment and skips contacts without a membership', async () => {
      const a = members.attend;
      const memberContact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, membershipId: a.membershipId } });
      const lead = await prisma.contact.create({ data: { studioId: ZEN, firstName: 'G3aLead', lastName: 'E2E', phone: phone(90), lifecycleStage: 'LEAD', isTest: true } });

      const definition: JourneyDefinition = {
        trigger: { kind: 'event', event: 'tag_added', filter: { combinator: 'and', rules: [{ field: 'contact.tags', op: 'has_any', value: ['e2e-g3a-start'] }] } },
        entryStepId: 'award',
        steps: { award: { type: 'award_points', points: 33, reasonKey: 'E2E G3A akis puani', next: null } },
        reentry: 'NEVER',
      };
      const invalid = await as(ownerToken, ZEN)
        .post(`/studios/${ZEN}/journeys`)
        .send({ name: 'E2E G3A gecersiz', definition: { ...definition, steps: { award: { type: 'award_points', points: 0, reasonKey: 'x', next: null } } } });
      expect(invalid.status).toBe(400);
      const create = await as(ownerToken, ZEN).post(`/studios/${ZEN}/journeys`).send({ name: 'E2E G3A puan akisi', definition });
      expect(create.status).toBe(201);
      const journeyId = create.body.id as string;
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/journeys/${journeyId}/activate`)).status).toBe(201);

      for (const id of [memberContact.id, lead.id]) {
        expect((await as(ownerToken, ZEN).post(`/crm/studios/${ZEN}/contacts/${id}/tags`).send({ add: ['e2e-g3a-start'] })).status).toBe(201);
      }
      const now = new Date();
      await runScheduler(now);
      await runScheduler(new Date(now.getTime() + 60_000));

      const enrollments = await prisma.journeyEnrollment.findMany({ where: { journeyId } });
      expect(enrollments).toHaveLength(2);
      const byContact = Object.fromEntries(enrollments.map((e) => [e.contactId, e]));
      const memberRun = await prisma.journeyStepRun.findFirstOrThrow({ where: { enrollmentId: byContact[memberContact.id].id, stepId: 'award' } });
      const leadRun = await prisma.journeyStepRun.findFirstOrThrow({ where: { enrollmentId: byContact[lead.id].id, stepId: 'award' } });
      expect(memberRun.status).toBe('DONE');
      expect(leadRun).toMatchObject({ status: 'SKIPPED', reasonCode: 'NO_MEMBERSHIP' });

      const awarded = await rowsOf(a, 'JOURNEY_AWARD');
      expect(awarded).toHaveLength(1);
      expect(awarded[0]).toMatchObject({ delta: 33, sourceType: 'journey', sourceId: `${byContact[memberContact.id].id}:award`, note: 'E2E G3A akis puani' });

      const retry = await app.get(LoyaltyEarnService).awardFromJourney({
        studioId: ZEN,
        contactId: memberContact.id,
        enrollmentId: byContact[memberContact.id].id,
        stepId: 'award',
        points: 33,
        reasonKey: 'E2E G3A akis puani',
      });
      expect(retry).toMatchObject({ status: 'DONE', duplicate: true });
      expect(await rowsOf(a, 'JOURNEY_AWARD')).toHaveLength(1);
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/journeys/${journeyId}/archive`)).status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------------

  describe('tenant isolation and permissions', () => {
    it('never shows or changes one tenant from another', async () => {
      const b = members.redeem;
      const flowMember = await makeMember('flow', 7, FLOW);
      expect((await as(flowOwnerToken, FLOW).get(`/studios/${FLOW}/loyalty/members/${b.memberId}`)).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).post(`/studios/${FLOW}/loyalty/members/${b.memberId}/adjust`).send({ points: 5, note: 'x' })).status).toBe(404);
      expect((await as(flowOwnerToken, ZEN).get(`${base()}/settings`)).status).toBe(403);
      expect((await as(ownerToken, ZEN).get(`${base()}/members/${flowMember.memberId}`)).status).toBe(404);
      const flowRewards = await as(flowOwnerToken, FLOW).get(`/studios/${FLOW}/loyalty/rewards`);
      expect(flowRewards.status).toBe(200);
      expect(flowRewards.body.items.find((r: { id: string }) => r.id === percentRewardId)).toBeUndefined();
      // A Zen reward id cannot be redeemed through Flow.
      const cross = await as(flowOwnerToken, FLOW).post(`/studios/${FLOW}/loyalty/members/${flowMember.memberId}/redeem`).send({ rewardId: giftRewardId });
      expect([404, 409]).toContain(cross.status);
      expect(await prisma.loyaltyLedger.count({ where: { membershipId: flowMember.membershipId } })).toBe(0);
    });

    it('enforces loyalty.view, loyalty.manage and loyalty.redeem', async () => {
      const b = members.redeem;
      for (const token of [trainerToken]) {
        expect((await as(token, ZEN).get(`${base()}/settings`)).status).toBe(403);
        expect((await as(token, ZEN).get(`${base()}/members/${b.memberId}`)).status).toBe(403);
        expect((await as(token, ZEN).post(`${base()}/members/${b.memberId}/redeem`).send({ rewardId: giftRewardId })).status).toBe(403);
      }
      // Reception: view and redeem by default, not manage.
      expect((await as(receptionToken, ZEN).get(`${base()}/settings`)).status).toBe(200);
      expect((await as(receptionToken, ZEN).put(`${base()}/settings`).send({ enabled: false })).status).toBe(403);
      expect((await as(receptionToken, ZEN).post(`${base()}/rules`).send({ kind: 'ATTENDANCE', name: 'E2E G3A x', points: 1 })).status).toBe(403);
      expect((await as(receptionToken, ZEN).post(`${base()}/members/${b.memberId}/adjust`).send({ points: 5, note: 'x' })).status).toBe(403);
      expect((await as(receptionToken, ZEN).post(`${base()}/members/${b.memberId}/redeem`).send({ rewardId: giftRewardId })).status).toBe(201);
    });

    it('stops earning and redeeming when the program is off', async () => {
      const b = members.redeem;
      await as(ownerToken, ZEN).put(`${base()}/settings`).send({ enabled: false });
      const off = await as(ownerToken, ZEN).post(`${base()}/members/${b.memberId}/redeem`).send({ rewardId: giftRewardId });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe('LOYALTY_DISABLED');
      const a = members.attend;
      const bookingId = await confirmedBooking(a, new Date(Date.now() - HOUR));
      expect((await as(ownerToken, ZEN).patch(`/schedules/check-in/${bookingId}`)).status).toBe(200);
      expect((await rowsOf(a, 'EARN_ATTENDANCE')).map((r) => r.sourceId)).not.toContain(bookingId);
      await as(ownerToken, ZEN).put(`${base()}/settings`).send({ enabled: true });
    });
  });
});
