import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomInt, randomUUID } from 'crypto';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { JobsService } from '../../src/modules/jobs/jobs.service';
import { BillingJobsService } from '../../src/modules/billing/billing-jobs.service';
import { ConversionService } from '../../src/modules/crm/conversions/conversion.service';
import { MockPaymentProvider } from '../../src/modules/payments/providers/mock-payment.provider';

/**
 * G5c-1 trial and activation (docs/DENEME_VE_ETKINLESTIRME.md): a new
 * business starts TRIALING for its plan's trial length, the heartbeat
 * sends reminders and restricts an expired trial, restricted mode blocks
 * core writes (staff and member self-service) but keeps reads, exports,
 * staff invites and activation, activation moves the studio to ACTIVE and
 * records studio_paid once on the platform tenant with attribution, a
 * provider webhook completes a pending platform payment, and the super
 * admin can extend, restrict and force-activate (audit logged). Seeded
 * demo tenants are ACTIVE and the extra demo tenant is TRIALING.
 *
 * Everything is created with the +9053988 phone prefix, the "e2e-g5c"
 * slug/plan prefix and e2e5c0 visitor ids, and removed in afterAll, so the
 * suite passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const PREFIX = '+9053988';
const SLUG = 'e2e-g5c';
const PLAN_KEY = 'e2e-g5c-plan';
const TRIAL_DAYS = 21;
const DAY = 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const phone = () => `${PREFIX}${String(randomInt(0, 100_000)).padStart(5, '0')}`;
const VISITOR = 'e2e5c000-0000-4000-8000-000000000001';

describe('Trial and activation G5c-1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let jobs: JobsService;
  let billingJobs: BillingJobsService;
  let conversions: ConversionService;

  let PLATFORM: string;
  let superToken: string;
  let ownerPhone: string;
  let ownerToken: string;
  let receptionToken: string;
  let memberToken: string;
  let memberProfileId: string;
  let studioId: string;
  let secondStudioId: string;

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
  });

  async function createTenant(slug: string, owner: string, planKey = PLAN_KEY) {
    const res = await admin()
      .post('/admin/tenants')
      .send({
        name: `E2E G5C ${slug}`,
        slug,
        businessTypeTemplateKey: 'pilates_studio',
        planKey,
        countryCode: 'TR',
        ownerFirstName: 'Deneme',
        ownerLastName: 'Sahibi',
        ownerPhone: owner,
      });
    expect(res.status).toBe(201);
    return res.body.studioId as string;
  }

  /** The owner accepts the invite (shortcut): a user with a password and an ACTIVE owner membership. */
  async function addUser(sid: string, roleKey: string, p: string, passwordHash: string) {
    const role = await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId: sid, key: roleKey } } });
    const user = await prisma.user.upsert({
      where: { phone: p },
      create: { phone: p, firstName: 'E2E', lastName: roleKey, passwordHash, phoneVerifiedAt: new Date() },
      update: {},
    });
    const membership = await prisma.membership.create({
      data: { userId: user.id, studioId: sid, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    return { userId: user.id, membershipId: membership.id };
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
      await prisma.visitor.deleteMany({ where: { studioId: PLATFORM, id: VISITOR } });
    }
    for (const id of ids) {
      await prisma.inviteToken.deleteMany({ where: { studioId: id } });
      await prisma.platformCreditLedger.deleteMany({ where: { studioId: id } });
      await prisma.platformBillingPayment.deleteMany({ where: { studioId: id } });
      await prisma.studio.delete({ where: { id } });
    }
    await prisma.user.deleteMany({ where: { phone: { startsWith: PREFIX } } });
    await prisma.plan.deleteMany({ where: { key: PLAN_KEY } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    jobs = moduleRef.get(JobsService);
    billingJobs = moduleRef.get(BillingJobsService);
    conversions = moduleRef.get(ConversionService);
    PLATFORM = (await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } })).id;
    await cleanup();

    superToken = await login(SUPER_ADMIN_PHONE);
    const plan = await admin()
      .post('/admin/plans')
      .send({ key: PLAN_KEY, name: 'E2E G5C', priceMonthly: 990, currency: 'EUR', trialDays: TRIAL_DAYS, limits: {} });
    expect(plan.status).toBe(201);
    expect(plan.body).toMatchObject({ currency: 'EUR', trialDays: TRIAL_DAYS });

    // The platform CRM knows the future owner: an ad click on the platform site, then the lead form.
    ownerPhone = phone();
    const tp = await request(server)
      .post('/track/platform/touchpoint')
      .set('User-Agent', UA)
      .send({
        visitorId: VISITOR,
        sessionId: randomUUID(),
        landingUrl: 'https://platform.example/tr/pilates?utm_source=google&utm_medium=cpc&pw_cid=5c1&pw_asid=5c2&gclid=G5C',
        utm: {},
        adIds: {},
        clickIds: {},
        consent: { analytics: true, advertising: true },
      });
    expect(tp.status).toBe(204);
    const lead = await request(server)
      .post('/public/studios/platform/leads')
      .set('X-PW-VID', VISITOR)
      .send({ fullName: 'Deneme Sahibi', phone: ownerPhone, consent: true });
    expect(lead.status).toBe(202);

    studioId = await createTenant(`${SLUG}-a`, ownerPhone);
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    await addUser(studioId, 'owner', ownerPhone, passwordHash);
    const receptionPhone = phone();
    await addUser(studioId, 'reception', receptionPhone, passwordHash);
    const memberPhone = phone();
    const member = await addUser(studioId, 'member', memberPhone, passwordHash);
    memberProfileId = (await prisma.memberProfile.create({ data: { membershipId: member.membershipId, studioId } })).id;
    ownerToken = await login(ownerPhone);
    receptionToken = await login(receptionPhone);
    memberToken = await login(memberPhone);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('seeded demo tenants are ACTIVE and the extra demo tenant is TRIALING', async () => {
    for (const slug of ['zen-reformer-pilates', 'flow-pilates-wellness', 'guc-pt-studyosu', 'denge-fizyoterapi']) {
      const s = await prisma.studio.findUniqueOrThrow({ where: { slug } });
      expect(s.billingStatus).toBe('ACTIVE');
      expect(s.activatedAt).not.toBeNull();
    }
    // Seeded 10 days before its trial end. Other suites run the heartbeat with a simulated
    // future clock, which may already have restricted it by the time this suite runs.
    const nova = await prisma.studio.findUniqueOrThrow({ where: { slug: 'nova-hareket-merkezi' } });
    expect(['TRIALING', 'RESTRICTED']).toContain(nova.billingStatus);
    expect(nova.activatedAt).toBeNull();
    expect(Math.round((nova.trialEndsAt!.getTime() - nova.trialStartedAt!.getTime()) / DAY)).toBe(14);
  });

  it('a new business starts TRIALING for the plan trial length and the signup is attributed', async () => {
    const studio = await prisma.studio.findUniqueOrThrow({ where: { id: studioId } });
    expect(studio.billingStatus).toBe('TRIALING');
    expect(studio.activatedAt).toBeNull();
    const length = studio.trialEndsAt!.getTime() - studio.trialStartedAt!.getTime();
    expect(Math.round(length / DAY)).toBe(TRIAL_DAYS);
    const sub = await prisma.subscription.findFirstOrThrow({ where: { studioId } });
    expect(sub.status).toBe('TRIALING');
    expect(sub.currentPeriodEnd.toISOString()).toBe(studio.trialEndsAt!.toISOString());

    const signup = await prisma.conversionEvent.findFirstOrThrow({ where: { studioId: PLATFORM, type: 'studio_signup', sourceId: studioId } });
    expect(signup.attributedTouchpointId).not.toBeNull();

    const summary = await as(ownerToken, studioId).get(`/studios/${studioId}/billing`);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ status: 'TRIALING', trialDaysLeft: TRIAL_DAYS, plan: { key: PLAN_KEY, currency: 'EUR' } });

    const me = await request(server).get('/auth/me').set('Authorization', `Bearer ${ownerToken}`);
    const membership = (me.body.memberships as { studioId: string; billing?: { status: string } }[]).find((m) => m.studioId === studioId);
    expect(membership?.billing?.status).toBe('TRIALING');

    const list = await admin().get('/admin/tenants');
    const row = (list.body.items as { id: string; billingStatus: string; trialEndsAt: string | null }[]).find((i) => i.id === studioId);
    expect(row).toMatchObject({ billingStatus: 'TRIALING' });
    expect(row?.trialEndsAt).toBe(studio.trialEndsAt!.toISOString());
  });

  it('billing is owner only: reception cannot see or activate it', async () => {
    expect((await as(receptionToken, studioId).get(`/studios/${studioId}/billing`)).status).toBe(403);
    expect((await as(receptionToken, studioId).post(`/studios/${studioId}/billing/activate`).send({ planKey: PLAN_KEY })).status).toBe(403);
  });

  it('the heartbeat sends the owner reminder once per threshold', async () => {
    await prisma.studio.update({ where: { id: studioId }, data: { trialEndsAt: new Date(Date.now() + 2.5 * DAY) } });
    await billingJobs.run(new Date());
    expect((await prisma.studio.findUniqueOrThrow({ where: { id: studioId } })).trialReminderSentDays).toBe(3);
    await billingJobs.run(new Date());
    expect((await prisma.studio.findUniqueOrThrow({ where: { id: studioId } })).trialReminderSentDays).toBe(3);
  });

  it('the expiry heartbeat restricts an expired trial (audit logged)', async () => {
    await prisma.studio.update({ where: { id: studioId }, data: { trialEndsAt: new Date(Date.now() - 60_000) } });
    const result = await jobs.runAll(new Date());
    expect(result.billing.restricted).toBeGreaterThanOrEqual(1);
    const studio = await prisma.studio.findUniqueOrThrow({ where: { id: studioId } });
    expect(studio.billingStatus).toBe('RESTRICTED');
    expect(await prisma.auditLog.count({ where: { studioId, action: 'billing.trial_expired' } })).toBe(1);
    // A second run does nothing more.
    await billingJobs.run(new Date());
    expect(await prisma.auditLog.count({ where: { studioId, action: 'billing.trial_expired' } })).toBe(1);
  });

  it('restricted mode blocks bookings, sales, products and member invites with a stable code', async () => {
    const owner = as(ownerToken, studioId);
    const booking = await owner.post('/schedules/book').send({ studioId, scheduleId: randomUUID(), memberId: memberProfileId });
    expect(booking.status).toBe(403);
    expect(booking.body.code).toBe('BILLING_RESTRICTED');

    const sale = await owner.post(`/studios/${studioId}/retail/sales`).send({ lines: [], paymentMethod: 'CASH' });
    expect(sale.status).toBe(403);
    expect(sale.body.code).toBe('BILLING_RESTRICTED');

    const product = await owner.post(`/studios/${studioId}/retail/products`).send({ name: 'x', price: '1.00' });
    expect(product.body.code).toBe('BILLING_RESTRICTED');

    const session = await owner.post('/schedules').send({ studioId });
    expect(session.body.code).toBe('BILLING_RESTRICTED');

    const campaign = await owner.post(`/studios/${studioId}/campaigns`).send({});
    expect(campaign.body.code).toBe('BILLING_RESTRICTED');

    const memberInvite = await owner.post('/invites').send({ studioId, roleKey: 'member', phone: phone(), fullName: 'Yeni Uye', channel: 'SHOWN' });
    expect(memberInvite.status).toBe(403);
    expect(memberInvite.body.code).toBe('BILLING_RESTRICTED');

    // Member self-service booking is blocked too.
    const self = await as(memberToken, studioId).post('/schedules/book/self').send({ studioId, scheduleId: randomUUID(), memberId: memberProfileId });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('BILLING_RESTRICTED');
  });

  it('restricted mode keeps reads, exports, staff invites and the super admin working', async () => {
    const owner = as(ownerToken, studioId);
    expect((await owner.get(`/schedules/studio/${studioId}`)).status).toBe(200);
    const csv = await owner.get(`/crm/studios/${studioId}/contacts/export`);
    expect(csv.status).toBe(200);
    const accounting = await owner.get(`/studios/${studioId}/accounting/export?format=csv&kind=sales`);
    expect(accounting.status).toBe(200);

    const staffInvite = await owner.post('/invites').send({ studioId, roleKey: 'reception', phone: phone(), fullName: 'Yeni Personel', channel: 'SHOWN' });
    expect(staffInvite.status).toBe(201);

    const asSuper = as(superToken, studioId);
    const superBooking = await asSuper.post('/schedules/book').send({ studioId, scheduleId: randomUUID(), memberId: memberProfileId });
    expect(superBooking.body.code).not.toBe('BILLING_RESTRICTED');
  });

  it('activation charges the plan, sets ACTIVE and records studio_paid exactly once', async () => {
    const res = await as(ownerToken, studioId).post(`/studios/${studioId}/billing/activate`).send({ planKey: PLAN_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ACTIVE', pending: false, payment: { status: 'COMPLETED', amount: '990.00', currency: 'EUR', planKey: PLAN_KEY } });

    const studio = await prisma.studio.findUniqueOrThrow({ where: { id: studioId } });
    expect(studio.billingStatus).toBe('ACTIVE');
    expect(studio.activatedAt).not.toBeNull();
    const subs = await prisma.subscription.findMany({ where: { studioId }, orderBy: { createdAt: 'asc' } });
    expect(subs.map((s) => s.status)).toEqual(['CANCELLED', 'ACTIVE']);
    expect(await prisma.auditLog.count({ where: { studioId, action: 'billing.activate' } })).toBe(1);

    const paid = await prisma.conversionEvent.findMany({ where: { studioId: PLATFORM, type: 'studio_paid', sourceId: studioId } });
    expect(paid).toHaveLength(1);
    expect(paid[0].valueAmount?.toFixed(2)).toBe('990.00');
    expect(paid[0].currency).toBe('EUR');
    expect(paid[0].attributedTouchpointId).not.toBeNull();

    // Already active: a second activation is refused, and a repeated hook records nothing new.
    const again = await as(ownerToken, studioId).post(`/studios/${studioId}/billing/activate`).send({ planKey: PLAN_KEY });
    expect(again.status).toBe(409);
    await conversions.recordStudioPaid(studioId, { kind: 'studio_activation', id: studioId }, { amount: '990.00', currency: 'EUR' });
    expect(await prisma.conversionEvent.count({ where: { studioId: PLATFORM, type: 'studio_paid', sourceId: studioId } })).toBe(1);

    // Writes work again once active.
    const booking = await as(ownerToken, studioId).post('/schedules/book').send({ studioId, scheduleId: randomUUID(), memberId: memberProfileId });
    expect(booking.body.code).not.toBe('BILLING_RESTRICTED');
    const payments = await as(ownerToken, studioId).get(`/studios/${studioId}/billing/payments`);
    expect(payments.body.items).toHaveLength(1);
  });

  it('super admin can extend, restrict and force-activate a trial; a provider webhook completes a pending payment', async () => {
    secondStudioId = await createTenant(`${SLUG}-b`, phone());
    const before = await prisma.studio.findUniqueOrThrow({ where: { id: secondStudioId } });

    const forbidden = await request(server)
      .post(`/admin/tenants/${secondStudioId}/trial/extend`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ days: 5 });
    expect(forbidden.status).toBe(403);

    const extended = await admin().post(`/admin/tenants/${secondStudioId}/trial/extend`).send({ days: 5 });
    expect(extended.status).toBe(200);
    const afterExtend = await prisma.studio.findUniqueOrThrow({ where: { id: secondStudioId } });
    expect(afterExtend.trialEndsAt!.getTime() - before.trialEndsAt!.getTime()).toBe(5 * DAY);
    expect(await prisma.auditLog.count({ where: { studioId: secondStudioId, action: 'billing.trial_extend' } })).toBe(1);

    const restricted = await admin().post(`/admin/tenants/${secondStudioId}/billing-status`).send({ status: 'RESTRICTED', reason: 'e2e' });
    expect(restricted.status).toBe(200);
    expect((await prisma.studio.findUniqueOrThrow({ where: { id: secondStudioId } })).billingStatus).toBe('RESTRICTED');
    expect(await prisma.auditLog.count({ where: { studioId: secondStudioId, action: 'billing.force_restrict' } })).toBe(1);

    // Extending a restricted trial reopens it.
    await admin().post(`/admin/tenants/${secondStudioId}/trial/extend`).send({ days: 3 });
    expect((await prisma.studio.findUniqueOrThrow({ where: { id: secondStudioId } })).billingStatus).toBe('TRIALING');

    // A real provider confirms later through the shared webhook URL.
    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: PLAN_KEY } });
    const reference = `mock_chk_${randomUUID()}`;
    await prisma.platformBillingPayment.create({
      data: { studioId: secondStudioId, planId: plan.id, listAmount: '990.00', amount: '990.00', currency: 'EUR', status: 'PENDING', provider: 'MOCK', providerReference: reference },
    });
    const body = JSON.stringify({ eventType: 'CHECKOUT_COMPLETED', providerReference: reference, amount: 990 });
    const hook = await request(server)
      .post('/payments/webhook/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', MockPaymentProvider.sign(body))
      .send(body);
    expect(hook.status).toBe(200);
    expect(hook.body).toMatchObject({ handled: true });
    expect((await prisma.studio.findUniqueOrThrow({ where: { id: secondStudioId } })).billingStatus).toBe('ACTIVE');
    const redelivered = await request(server)
      .post('/payments/webhook/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', MockPaymentProvider.sign(body))
      .send(body);
    expect(redelivered.body).toMatchObject({ alreadyProcessed: true });

    // Extending an active studio is refused; restrict then force-activate without payment.
    expect((await admin().post(`/admin/tenants/${secondStudioId}/trial/extend`).send({ days: 3 })).status).toBe(409);
    await admin().post(`/admin/tenants/${secondStudioId}/billing-status`).send({ status: 'RESTRICTED' });
    const forced = await admin().post(`/admin/tenants/${secondStudioId}/billing-status`).send({ status: 'ACTIVE', planKey: PLAN_KEY, reason: 'e2e' });
    expect(forced.status).toBe(200);
    expect((await prisma.studio.findUniqueOrThrow({ where: { id: secondStudioId } })).billingStatus).toBe('ACTIVE');
    expect(await prisma.auditLog.count({ where: { studioId: secondStudioId, action: 'billing.force_activate' } })).toBe(1);
  });
});
