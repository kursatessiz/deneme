import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomInt, randomUUID } from 'crypto';
import { PrismaClient } from '@platform/database';
import type { PlatformBillingSettings, PlatformReferralRewardAmount } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { StudioReferralsService } from '../../src/modules/billing/studio-referrals.service';

/**
 * G5c-1 business-to-business referrals (docs/DENEME_VE_ETKINLESTIRME.md):
 * the owner's platform-level code, attribution through a pw_ref visit on
 * the platform site, the reward written only after the referred business
 * pays and only once, the credit consumed by the referrer's own payment,
 * self-referral rejected, tenant isolation and the super-admin overview.
 *
 * G5c-1b: an AMOUNT reward is credited in the referrer's billing currency,
 * and a super-admin force-activation counts as a paying customer only with
 * recordAsPaid (studio_paid and the reward, each exactly once).
 *
 * Everything uses the +9053987 phone prefix, the "e2e-b2b" slug/plan
 * prefix and e2eb2b visitor ids, and is removed in afterAll; the platform
 * billing settings row is restored.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const ZEN_OWNER_PHONE = '+905321000002';
const PREFIX = '+9053987';
const SLUG = 'e2e-b2b';
const PLAN_KEY = 'e2e-b2b-plan';
const VISITOR = 'e2eb2b00-0000-4000-8000-000000000001';
const VISITOR_2 = 'e2eb2b00-0000-4000-8000-000000000002';
const VISITOR_3 = 'e2eb2b00-0000-4000-8000-000000000003';
/** Amounts come back ordered by currency code. */
const REWARD = { kind: 'AMOUNT', amounts: [{ currency: 'EUR', amount: '10.00' }, { currency: 'TRY', amount: '250.00' }] };
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const phone = () => `${PREFIX}${String(randomInt(0, 100_000)).padStart(5, '0')}`;

describe('Business-to-business referrals G5c-1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let referrals: StudioReferralsService;

  let PLATFORM: string;
  let ZEN: string;
  let passwordHash: string;
  let superToken: string;
  let zenOwnerToken: string;
  let originalSettings: PlatformBillingSettings | null;
  let originalAmounts: PlatformReferralRewardAmount[];

  let referrerId: string;
  let referrerOwnerPhone: string;
  let referrerToken: string;
  let code: string;
  let referredId: string;
  let referredToken: string;

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, sid: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', sid),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', sid),
  });
  const admin = () => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${superToken}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${superToken}`),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${superToken}`),
  });

  async function createTenant(slug: string, ownerPhone: string, referralCode?: string) {
    const res = await admin()
      .post('/admin/tenants')
      .send({
        name: `E2E B2B ${slug}`,
        slug,
        businessTypeTemplateKey: 'pilates_studio',
        planKey: PLAN_KEY,
        countryCode: 'TR',
        ownerFirstName: 'Tavsiye',
        ownerLastName: 'Sahibi',
        ownerPhone,
        ...(referralCode ? { referralCode } : {}),
      });
    expect(res.status).toBe(201);
    return res.body.studioId as string;
  }

  async function addOwner(sid: string, p: string) {
    const role = await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId: sid, key: 'owner' } } });
    const user = await prisma.user.upsert({
      where: { phone: p },
      create: { phone: p, firstName: 'E2E', lastName: 'Sahip', passwordHash, phoneVerifiedAt: new Date() },
      update: {},
    });
    await prisma.membership.create({ data: { userId: user.id, studioId: sid, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() } });
  }

  async function cleanup() {
    const studios = await prisma.studio.findMany({ where: { slug: { startsWith: SLUG } }, select: { id: true } });
    const ids = studios.map((s) => s.id);
    if (PLATFORM) {
      await prisma.conversionEvent.deleteMany({ where: { studioId: PLATFORM, sourceId: { in: ids } } });
      const contacts = await prisma.contact.findMany({ where: { studioId: PLATFORM, phone: { startsWith: PREFIX } }, select: { id: true } });
      const contactIds = contacts.map((c) => c.id);
      await prisma.conversionEvent.deleteMany({ where: { contactId: { in: contactIds } } });
      await prisma.contactActivity.deleteMany({ where: { contactId: { in: contactIds } } });
      await prisma.contactTask.deleteMany({ where: { contactId: { in: contactIds } } });
      await prisma.lead.deleteMany({ where: { studioId: PLATFORM, phone: { startsWith: PREFIX } } });
      await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
      await prisma.visitor.deleteMany({ where: { studioId: PLATFORM, id: { in: [VISITOR, VISITOR_2, VISITOR_3] } } });
    }
    await prisma.studioReferral.deleteMany({ where: { OR: [{ referrerStudioId: { in: ids } }, { referredStudioId: { in: ids } }] } });
    for (const id of ids) {
      await prisma.inviteToken.deleteMany({ where: { studioId: id } });
      await prisma.platformCreditLedger.deleteMany({ where: { studioId: id } });
      await prisma.platformBillingPayment.deleteMany({ where: { studioId: id } });
      await prisma.studio.delete({ where: { id } });
    }
    await prisma.user.deleteMany({ where: { phone: { startsWith: PREFIX } } });
    await prisma.plan.deleteMany({ where: { key: PLAN_KEY } });
  }

  const ledgerOf = (sid: string) => prisma.platformCreditLedger.findMany({ where: { studioId: sid }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    referrals = moduleRef.get(StudioReferralsService);
    PLATFORM = (await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } })).id;
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    originalSettings = await prisma.platformBillingSettings.findUnique({ where: { id: 'platform' } });
    originalAmounts = await prisma.platformReferralRewardAmount.findMany();
    await cleanup();
    passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);

    superToken = await login(SUPER_ADMIN_PHONE);
    zenOwnerToken = await login(ZEN_OWNER_PHONE);
    // Deprecated single-price input still works (TRY only).
    const plan = await admin().post('/admin/plans').send({ key: PLAN_KEY, name: 'E2E B2B', priceMonthly: 500, currency: 'TRY', trialDays: 14, limits: {} });
    expect(plan.status).toBe(201);
    expect(plan.body.prices).toEqual([{ currency: 'TRY', priceMonthly: '500.00' }]);
    // Reward: 250 TRY (or 10 EUR) of subscription credit, in the referrer's billing currency.
    const settings = await admin().put('/admin/billing/settings').send({ referralReward: REWARD });
    expect(settings.status).toBe(200);

    referrerOwnerPhone = phone();
    referrerId = await createTenant(`${SLUG}-referrer`, referrerOwnerPhone);
    await addOwner(referrerId, referrerOwnerPhone);
    referrerToken = await login(referrerOwnerPhone);
  });

  afterAll(async () => {
    await cleanup();
    if (originalSettings) {
      const { id, updatedAt: _updatedAt, ...rest } = originalSettings;
      await prisma.platformBillingSettings.update({ where: { id }, data: rest });
    } else {
      await prisma.platformBillingSettings.deleteMany({ where: { id: 'platform' } });
    }
    await prisma.platformReferralRewardAmount.deleteMany({});
    if (originalAmounts.length > 0) await prisma.platformReferralRewardAmount.createMany({ data: originalAmounts.map(({ currency, amount }) => ({ currency, amount })) });
    await prisma.$disconnect();
    await app.close();
  });

  it('the owner gets one stable platform-level referral code', async () => {
    const first = await as(referrerToken, referrerId).get(`/studios/${referrerId}/business-referrals`);
    expect(first.status).toBe(200);
    code = first.body.code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(first.body.query).toBe(`?pw_ref=${code}`);
    // The owner sees the reward in its own billing currency (TRY for a business in Turkey).
    expect(first.body.reward).toEqual({ amount: '250.00', currency: 'TRY', months: null });
    expect(first.body.referrals).toEqual([]);
    const second = await as(referrerToken, referrerId).get(`/studios/${referrerId}/business-referrals`);
    expect(second.body.code).toBe(code);
  });

  it('a pw_ref visit on the platform site attributes the new business to the referrer', async () => {
    const referredOwner = phone();
    const tp = await request(server)
      .post('/track/platform/touchpoint')
      .set('User-Agent', UA)
      .send({
        visitorId: VISITOR,
        sessionId: randomUUID(),
        landingUrl: `https://platform.example/tr?pw_ref=${code.toLowerCase()}`,
        utm: {},
        adIds: {},
        clickIds: {},
        consent: { analytics: true, advertising: false },
      });
    expect(tp.status).toBe(204);
    expect((await prisma.touchpoint.findFirstOrThrow({ where: { studioId: PLATFORM, visitorId: VISITOR } })).refCode).toBe(code);

    const lead = await request(server).post('/public/studios/platform/leads').set('X-PW-VID', VISITOR).send({ fullName: 'Gelen Isletme', phone: referredOwner, consent: true });
    expect(lead.status).toBe(202);

    referredId = await createTenant(`${SLUG}-referred`, referredOwner);
    const referral = await prisma.studioReferral.findUniqueOrThrow({ where: { referredStudioId: referredId } });
    expect(referral).toMatchObject({ referrerStudioId: referrerId, code, source: 'TOUCHPOINT', status: 'SIGNED_UP' });
    expect(referral.touchpointId).not.toBeNull();

    await addOwner(referredId, referredOwner);
    referredToken = await login(referredOwner);
  });

  it('writes no reward before the referred business pays', async () => {
    expect(await ledgerOf(referrerId)).toHaveLength(0);
    const overview = await as(referrerToken, referrerId).get(`/studios/${referrerId}/business-referrals`);
    expect(overview.body.referrals).toHaveLength(1);
    expect(overview.body.referrals[0]).toMatchObject({ status: 'SIGNED_UP', reward: null });
    expect(overview.body.credit).toEqual({ amounts: [], months: 0 });
  });

  it('rewards the referrer once when the referred business activates', async () => {
    const activated = await as(referredToken, referredId).post(`/studios/${referredId}/billing/activate`).send({ planKey: PLAN_KEY });
    expect(activated.status).toBe(200);
    expect(activated.body.status).toBe('ACTIVE');

    const ledger = await ledgerOf(referrerId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ kind: 'REFERRAL_REWARD', currency: 'TRY', idempotencyKey: `referral-reward:${referredId}` });
    expect(ledger[0].amount?.toFixed(2)).toBe('250.00');
    expect((await prisma.studioReferral.findUniqueOrThrow({ where: { referredStudioId: referredId } })).status).toBe('REWARDED');

    // Idempotent: a repeated activation hook writes nothing more.
    await referrals.onReferredStudioActivated(referredId);
    await referrals.onReferredStudioActivated(referredId);
    expect(await ledgerOf(referrerId)).toHaveLength(1);

    const overview = await as(referrerToken, referrerId).get(`/studios/${referrerId}/business-referrals`);
    expect(overview.body.referrals[0]).toMatchObject({ status: 'REWARDED', reward: { amount: '250.00', currency: 'TRY', months: null } });
    expect(overview.body.credit).toEqual({ amounts: [{ currency: 'TRY', amount: '250.00' }], months: 0 });
  });

  it("the referrer's own payment consumes the credit", async () => {
    const res = await as(referrerToken, referrerId).post(`/studios/${referrerId}/billing/activate`).send({ planKey: PLAN_KEY });
    expect(res.status).toBe(200);
    expect(res.body.payment).toMatchObject({ listAmount: '500.00', creditAmount: '250.00', amount: '250.00', currency: 'TRY', status: 'COMPLETED' });
    const summary = await as(referrerToken, referrerId).get(`/studios/${referrerId}/billing`);
    expect(summary.body.credit).toEqual({ amounts: [], months: 0 });
    const ledger = await ledgerOf(referrerId);
    expect(ledger.map((l) => l.kind)).toEqual(['REFERRAL_REWARD', 'APPLIED']);
  });

  it('rejects a self-referral and never rewards it', async () => {
    // The referrer's own owner opens a second business with the same code.
    const selfId = await createTenant(`${SLUG}-self`, referrerOwnerPhone, code);
    const referral = await prisma.studioReferral.findUniqueOrThrow({ where: { referredStudioId: selfId } });
    expect(referral).toMatchObject({ source: 'MANUAL', status: 'REJECTED', rejectReason: 'SELF_REFERRAL' });

    await addOwner(selfId, referrerOwnerPhone);
    const token = await login(referrerOwnerPhone);
    const activated = await as(token, selfId).post(`/studios/${selfId}/billing/activate`).send({ planKey: PLAN_KEY });
    expect(activated.status).toBe(200);
    expect((await ledgerOf(referrerId)).filter((l) => l.kind === 'REFERRAL_REWARD')).toHaveLength(1);

    // An unknown code records nothing.
    const other = await createTenant(`${SLUG}-unknown`, phone(), 'ZZZZZZZZ');
    expect(await prisma.studioReferral.findUnique({ where: { referredStudioId: other } })).toBeNull();
  });

  it('keeps referrals and credits tenant-isolated', async () => {
    // Another tenant's owner cannot read this studio's referrals, nor the referred business its referrer's.
    expect((await as(zenOwnerToken, referrerId).get(`/studios/${referrerId}/business-referrals`)).status).toBe(403);
    const referredView = await as(referredToken, referredId).get(`/studios/${referredId}/business-referrals`);
    expect(referredView.status).toBe(200);
    expect(referredView.body.referrals).toEqual([]);
    expect(referredView.body.credit).toEqual({ amounts: [], months: 0 });
    expect(referredView.body.code).not.toBe(code);
    // Zen's own view never lists these test businesses.
    const zenView = await as(zenOwnerToken, ZEN).get(`/studios/${ZEN}/business-referrals`);
    expect((zenView.body.referrals as { referredStudioName: string }[]).some((r) => r.referredStudioName.startsWith('E2E B2B'))).toBe(false);
  });

  it('super admin sees the referral overview; nobody else does', async () => {
    const res = await admin().get('/admin/business-referrals');
    expect(res.status).toBe(200);
    const mine = (res.body.items as { referrerStudioId: string; referredStudioId: string; status: string }[]).filter((i) => i.referrerStudioId === referrerId);
    expect(mine.map((i) => i.status).sort()).toEqual(['REJECTED', 'REWARDED']);
    expect(res.body.reward).toEqual(REWARD);
    expect((await request(server).get('/admin/business-referrals').set('Authorization', `Bearer ${referrerToken}`)).status).toBe(403);
    const bad = await admin().put('/admin/billing/settings').send({ referralReward: { kind: 'FREE_MONTHS', months: 0 } });
    expect(bad.status).toBe(400);
  });

  /** A new business that arrived through the referrer's pw_ref link and whose owner is known to the platform CRM. */
  async function referredBusiness(slug: string, visitorId: string) {
    const owner = phone();
    const tp = await request(server)
      .post('/track/platform/touchpoint')
      .set('User-Agent', UA)
      .send({
        visitorId,
        sessionId: randomUUID(),
        landingUrl: `https://platform.example/tr?pw_ref=${code}`,
        utm: {},
        adIds: {},
        clickIds: {},
        consent: { analytics: true, advertising: false },
      });
    expect(tp.status).toBe(204);
    const lead = await request(server).post('/public/studios/platform/leads').set('X-PW-VID', visitorId).send({ fullName: 'Zorla Etkin', phone: owner, consent: true });
    expect(lead.status).toBe(202);
    const sid = await createTenant(slug, owner);
    await addOwner(sid, owner);
    expect((await prisma.studioReferral.findUniqueOrThrow({ where: { referredStudioId: sid } })).status).toBe('SIGNED_UP');
    return sid;
  }

  const paidEvents = (sid: string) => prisma.conversionEvent.count({ where: { studioId: PLATFORM, type: 'studio_paid', sourceId: sid } });
  const rewardsFor = (sid: string) => prisma.platformCreditLedger.count({ where: { kind: 'REFERRAL_REWARD', idempotencyKey: `referral-reward:${sid}` } });

  it('a force-activation without recordAsPaid is not a paying customer: no studio_paid, no reward', async () => {
    const sid = await referredBusiness(`${SLUG}-forced-free`, VISITOR_2);
    const res = await admin().post(`/admin/tenants/${sid}/billing-status`).send({ status: 'ACTIVE', planKey: PLAN_KEY, reason: 'e2e' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ACTIVE', recordAsPaid: false });
    expect(await paidEvents(sid)).toBe(0);
    expect(await rewardsFor(sid)).toBe(0);
    expect((await prisma.studioReferral.findUniqueOrThrow({ where: { referredStudioId: sid } })).status).toBe('SIGNED_UP');
    const log = await prisma.auditLog.findFirstOrThrow({ where: { studioId: sid, action: 'billing.force_activate' } });
    expect(log.metadata).toMatchObject({ recordAsPaid: false, paidValue: null });
  });

  it('a force-activation with recordAsPaid records studio_paid and rewards the referrer in its billing currency, exactly once', async () => {
    // The referrer is now billed in EUR (super-admin override): its money reward is the EUR amount.
    await admin().put(`/admin/tenants/${referrerId}/billing-currency`).send({ currency: 'EUR', reason: 'e2e' }).expect(200);
    const sid = await referredBusiness(`${SLUG}-forced-paid`, VISITOR_3);
    const res = await admin().post(`/admin/tenants/${sid}/billing-status`).send({ status: 'ACTIVE', planKey: PLAN_KEY, recordAsPaid: true, reason: 'offline' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ACTIVE', recordAsPaid: true });

    // Same as a paid activation: studio_paid at the plan's list price in the studio's currency, attributed.
    const paid = await prisma.conversionEvent.findMany({ where: { studioId: PLATFORM, type: 'studio_paid', sourceId: sid } });
    expect(paid).toHaveLength(1);
    expect(paid[0].valueAmount?.toFixed(2)).toBe('500.00');
    expect(paid[0].currency).toBe('TRY');
    expect(paid[0].attributedTouchpointId).not.toBeNull();
    const reward = await prisma.platformCreditLedger.findUniqueOrThrow({ where: { idempotencyKey: `referral-reward:${sid}` } });
    expect(reward).toMatchObject({ studioId: referrerId, kind: 'REFERRAL_REWARD', currency: 'EUR', months: null });
    expect(reward.amount?.toFixed(2)).toBe('10.00');
    expect((await prisma.studioReferral.findUniqueOrThrow({ where: { referredStudioId: sid } })).status).toBe('REWARDED');
    const log = await prisma.auditLog.findFirstOrThrow({ where: { studioId: sid, action: 'billing.force_activate' } });
    expect(log.metadata).toMatchObject({ recordAsPaid: true, paidValue: { amount: '500.00', currency: 'TRY' }, reason: 'offline' });

    // Repeating it (already ACTIVE, then restrict and force again) never records or rewards twice.
    expect((await admin().post(`/admin/tenants/${sid}/billing-status`).send({ status: 'ACTIVE', planKey: PLAN_KEY, recordAsPaid: true })).body).toEqual({
      status: 'ACTIVE',
      recordAsPaid: false,
    });
    await admin().post(`/admin/tenants/${sid}/billing-status`).send({ status: 'RESTRICTED' }).expect(200);
    await admin().post(`/admin/tenants/${sid}/billing-status`).send({ status: 'ACTIVE', planKey: PLAN_KEY, recordAsPaid: true }).expect(200);
    expect(await paidEvents(sid)).toBe(1);
    expect(await rewardsFor(sid)).toBe(1);
    // A later real payment path also stays at one.
    await referrals.onReferredStudioActivated(sid);
    expect(await rewardsFor(sid)).toBe(1);

    // The EUR credit shows next to the TRY history, never converted.
    const overview = await as(referrerToken, referrerId).get(`/studios/${referrerId}/business-referrals`);
    expect(overview.body.reward).toEqual({ amount: '10.00', currency: 'EUR', months: null });
    expect(overview.body.credit).toEqual({ amounts: [{ currency: 'EUR', amount: '10.00' }], months: 0 });
  });

  it('recordAsPaid is refused for a restriction and for a plan with no price in the billing currency', async () => {
    const sid = await createTenant(`${SLUG}-forced-bad`, phone());
    expect((await admin().post(`/admin/tenants/${sid}/billing-status`).send({ status: 'RESTRICTED', recordAsPaid: true })).status).toBe(400);
    await admin().put(`/admin/tenants/${sid}/billing-currency`).send({ currency: 'USD' }).expect(200);
    const res = await admin().post(`/admin/tenants/${sid}/billing-status`).send({ status: 'ACTIVE', planKey: PLAN_KEY, recordAsPaid: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PLAN_PRICE_UNAVAILABLE');
    expect((await prisma.studio.findUniqueOrThrow({ where: { id: sid } })).billingStatus).toBe('TRIALING');
  });

  it('the super admin edits the reward per billing currency (audit logged); a currency without an amount gets the default month', async () => {
    const perCurrency = {
      kind: 'AMOUNT',
      amounts: [
        { currency: 'GBP', amount: '8.00' },
        { currency: 'TRY', amount: '300.00' },
      ],
    };
    const saved = await admin().put('/admin/billing/settings').send({ referralReward: perCurrency });
    expect(saved.status).toBe(200);
    expect(saved.body.referralReward).toEqual(perCurrency);
    expect((await admin().get('/admin/billing/settings')).body.referralReward).toEqual(perCurrency);
    expect((await prisma.platformReferralRewardAmount.findMany({ orderBy: { currency: 'asc' } })).map((r) => r.currency)).toEqual(['GBP', 'TRY']);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'billing.settings_update', userId: { not: null } }, orderBy: { createdAt: 'desc' } });
    expect(log.metadata).toMatchObject({ previous: REWARD, referralReward: perCurrency });

    // The referrer is billed in EUR (earlier override) and EUR has no amount now: one free month, never a conversion.
    const overview = await as(referrerToken, referrerId).get(`/studios/${referrerId}/business-referrals`);
    expect(overview.body.reward).toEqual({ amount: null, currency: null, months: 1 });
    // Pinned to GBP it earns the GBP amount.
    await admin().put(`/admin/tenants/${referrerId}/billing-currency`).send({ currency: 'GBP' }).expect(200);
    expect((await as(referrerToken, referrerId).get(`/studios/${referrerId}/business-referrals`)).body.reward).toEqual({ amount: '8.00', currency: 'GBP', months: null });

    // Back to free months clears the amounts; only the super admin may edit.
    const months = await admin().put('/admin/billing/settings').send({ referralReward: { kind: 'FREE_MONTHS', months: 2 } });
    expect(months.body.referralReward).toEqual({ kind: 'FREE_MONTHS', months: 2 });
    expect(await prisma.platformReferralRewardAmount.count()).toBe(0);
    const forbidden = await request(server).put('/admin/billing/settings').set('Authorization', `Bearer ${referrerToken}`).send({ referralReward: perCurrency });
    expect(forbidden.status).toBe(403);
  });
});
