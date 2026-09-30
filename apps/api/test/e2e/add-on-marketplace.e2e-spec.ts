import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomInt, randomUUID } from 'crypto';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { AddOnJobsService } from '../../src/modules/billing/add-ons/add-ons-jobs.service';
import { BillingJobsService } from '../../src/modules/billing/billing-jobs.service';
import { MockPaymentProvider } from '../../src/modules/payments/providers/mock-payment.provider';
import { PaymentProviderRegistry } from '../../src/modules/payments/providers/payment-provider.registry';

/**
 * G5c-2 add-on marketplace (docs/UYGULAMA_PAZARI.md): super admin catalogue
 * CRUD with publish gating and audit, the tenant catalogue with the price in
 * the tenant's billing currency (and a stable reason when there is none),
 * one free trial per add-on and tenant, activation through the platform
 * billing path (MOCK provider) that turns the feature flag on, cancellation
 * that keeps access until the period end, the heartbeat that expires trials
 * and cancelled periods, renewal charges with dunning, restricted-mode
 * tenants that cannot start trials, owner-only permission and add-on revenue
 * that is never summed across currencies.
 *
 * Everything is created with the +9053986 phone prefix and the "e2e-g5c2"
 * slug/plan/add-on prefix and removed in afterAll, so the suite passes twice
 * in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const PREFIX = '+9053986';
const SLUG = 'e2e-g5c2';
const PLAN_KEY = 'e2e-g5c2-plan';
const ADDON_KEY = 'e2e-g5c2-video';
const DRAFT_KEY = 'e2e-g5c2-draft';
const FLAG = 'video_content';
const DAY = 24 * 60 * 60 * 1000;

const phone = () => `${PREFIX}${String(randomInt(0, 100_000)).padStart(5, '0')}`;

interface AddOnItem {
  key: string;
  state: string;
  hasAccess: boolean;
  trialDaysLeft: number | null;
  trialAvailable: boolean;
  purchasable: boolean;
  purchaseBlockedReason: string | null;
  price: { currency: string; priceMonthly: string; priceYearly: string } | null;
  billingInterval: string | null;
  currentPeriodEnd: string | null;
  paymentOverdue: boolean;
}

describe('Add-on marketplace G5c-2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let addOnJobs: AddOnJobsService;
  let billingJobs: BillingJobsService;
  let mock: MockPaymentProvider;

  let superToken: string;
  let addOnId: string;
  const tenants = {} as Record<'tr' | 'de' | 'us' | 'restricted', { studioId: string; ownerToken: string; receptionToken: string }>;

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
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${superToken}`),
  });
  const owner = (t: keyof typeof tenants) => as(tenants[t].ownerToken, tenants[t].studioId);
  const base = (t: keyof typeof tenants) => `/studios/${tenants[t].studioId}`;

  async function item(t: keyof typeof tenants, key = ADDON_KEY): Promise<AddOnItem> {
    const res = await owner(t).get(`${base(t)}/add-ons`);
    expect(res.status).toBe(200);
    const found = (res.body.items as AddOnItem[]).find((i) => i.key === key);
    if (!found) throw new Error(`add-on ${key} not listed for ${t}`);
    return found;
  }

  async function enabledFlags(t: keyof typeof tenants): Promise<string[]> {
    const res = await as(tenants[t].receptionToken, tenants[t].studioId).get(`${base(t)}/features`);
    expect(res.status).toBe(200);
    return res.body.enabled as string[];
  }

  async function createTenant(slug: string, owner: string, countryCode: string) {
    const res = await admin()
      .post('/admin/tenants')
      .send({
        name: `E2E G5C2 ${slug}`,
        slug,
        businessTypeTemplateKey: 'pilates_studio',
        planKey: PLAN_KEY,
        countryCode,
        ownerFirstName: 'Uygulama',
        ownerLastName: 'Sahibi',
        ownerPhone: owner,
      });
    expect(res.status).toBe(201);
    return res.body.studioId as string;
  }

  async function addUser(sid: string, roleKey: string, p: string, passwordHash: string) {
    const role = await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId: sid, key: roleKey } } });
    const user = await prisma.user.upsert({
      where: { phone: p },
      create: { phone: p, firstName: 'E2E', lastName: roleKey, passwordHash, phoneVerifiedAt: new Date() },
      update: {},
    });
    await prisma.membership.create({ data: { userId: user.id, studioId: sid, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() } });
  }

  async function cleanup() {
    const studios = await prisma.studio.findMany({ where: { slug: { startsWith: SLUG } }, select: { id: true } });
    for (const { id } of studios) {
      await prisma.inviteToken.deleteMany({ where: { studioId: id } });
      await prisma.platformCreditLedger.deleteMany({ where: { studioId: id } });
      await prisma.platformBillingPayment.deleteMany({ where: { studioId: id } });
      await prisma.studioAddOn.deleteMany({ where: { studioId: id } });
      await prisma.studio.delete({ where: { id } });
    }
    const addOns = await prisma.addOn.findMany({ where: { key: { startsWith: 'e2e-g5c2' } }, select: { id: true } });
    const ids = addOns.map((a) => a.id);
    await prisma.platformBillingPayment.deleteMany({ where: { studioAddOn: { addOnId: { in: ids } } } });
    await prisma.studioAddOn.deleteMany({ where: { addOnId: { in: ids } } });
    await prisma.addOn.deleteMany({ where: { id: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entityType: 'AddOn', entityId: { in: ids } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: PREFIX } } });
    await prisma.plan.deleteMany({ where: { key: PLAN_KEY } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    addOnJobs = moduleRef.get(AddOnJobsService);
    billingJobs = moduleRef.get(BillingJobsService);
    mock = moduleRef.get(PaymentProviderRegistry).default as MockPaymentProvider;
    expect(mock.name).toBe('MOCK');
    await cleanup();

    superToken = await login(SUPER_ADMIN_PHONE);
    const plan = await admin()
      .post('/admin/plans')
      .send({
        key: PLAN_KEY,
        name: 'E2E G5C2',
        prices: [
          { currency: 'TRY', priceMonthly: 1000 },
          { currency: 'EUR', priceMonthly: 30 },
          { currency: 'USD', priceMonthly: 35 },
        ],
        limits: {},
      });
    expect(plan.status).toBe(201);

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    for (const [name, country] of [
      ['tr', 'TR'],
      ['de', 'DE'],
      ['us', 'US'],
      ['restricted', 'TR'],
    ] as const) {
      const ownerPhone = phone();
      const studioId = await createTenant(`${SLUG}-${name}`, ownerPhone, country);
      await addUser(studioId, 'owner', ownerPhone, passwordHash);
      const receptionPhone = phone();
      await addUser(studioId, 'reception', receptionPhone, passwordHash);
      tenants[name] = { studioId, ownerToken: await login(ownerPhone), receptionToken: await login(receptionPhone) };
    }
    const restricted = await admin().post(`/admin/tenants/${tenants.restricted.studioId}/billing-status`).send({ status: 'RESTRICTED', reason: 'e2e' });
    expect(restricted.status).toBe(200);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Catalogue (super admin)
  // ---------------------------------------------------------------------------

  it('super admin creates a draft, publish is refused without a price, prices and publish work, all audit logged', async () => {
    const body = {
      key: ADDON_KEY,
      name: { tr: 'E2E Video', en: 'E2E Video' },
      description: { tr: 'Aciklama', en: 'Description' },
      promoVideoUrl: 'https://example.com/promo',
      screenshotUrls: ['https://example.com/s1.png'],
      featureFlagKey: FLAG,
      trialDays: 14,
      sortOrder: 5,
    };
    const created = await admin().post('/admin/add-ons').send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: ADDON_KEY, isPublished: false, prices: [], tenantCount: 0, trialDays: 14 });
    addOnId = created.body.id as string;

    // Validation: both languages, https, key format, unknown fields.
    expect((await admin().post('/admin/add-ons').send({ ...body, key: `${ADDON_KEY}-x`, name: { tr: 'Sadece' } })).status).toBe(400);
    expect((await admin().post('/admin/add-ons').send({ ...body, key: `${ADDON_KEY}-x`, promoVideoUrl: 'http://insecure.example' })).status).toBe(400);
    expect((await admin().post('/admin/add-ons').send({ ...body, key: 'Bad Key' })).status).toBe(400);
    const dup = await admin().post('/admin/add-ons').send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('ADD_ON_KEY_EXISTS');

    // Publish gating: no price, no publish.
    const early = await admin().patch(`/admin/add-ons/${addOnId}`).send({ isPublished: true });
    expect(early.status).toBe(400);
    expect(early.body.code).toBe('ADD_ON_PUBLISH_NEEDS_PRICE');

    // Prices: platform currencies only, positive two-decimal amounts.
    expect((await admin().put(`/admin/add-ons/${addOnId}/prices`).send({ prices: [{ currency: 'CHF', priceMonthly: 9, priceYearly: 90 }] })).status).toBe(400);
    expect((await admin().put(`/admin/add-ons/${addOnId}/prices`).send({ prices: [{ currency: 'EUR', priceMonthly: 0, priceYearly: 90 }] })).status).toBe(400);
    const priced = await admin()
      .put(`/admin/add-ons/${addOnId}/prices`)
      .send({
        prices: [
          { currency: 'TRY', priceMonthly: 199, priceYearly: 1990 },
          { currency: 'EUR', priceMonthly: 9, priceYearly: 90 },
        ],
      });
    expect(priced.status).toBe(200);
    expect(priced.body.prices).toEqual([
      { currency: 'TRY', priceMonthly: '199.00', priceYearly: '1990.00' },
      { currency: 'EUR', priceMonthly: '9.00', priceYearly: '90.00' },
    ]);

    const published = await admin().patch(`/admin/add-ons/${addOnId}`).send({ isPublished: true });
    expect(published.status).toBe(200);
    expect(published.body.isPublished).toBe(true);

    // A published add-on cannot lose its last price.
    const emptied = await admin().put(`/admin/add-ons/${addOnId}/prices`).send({ prices: [] });
    expect(emptied.status).toBe(409);

    // Unknown fields and the key are not editable.
    expect((await admin().patch(`/admin/add-ons/${addOnId}`).send({ key: 'other' })).status).toBe(400);

    // A second add-on stays a draft: tenants never see it.
    const draft = await admin()
      .post('/admin/add-ons')
      .send({ key: DRAFT_KEY, name: { tr: 'Taslak', en: 'Draft' }, description: { tr: 'T', en: 'D' }, featureFlagKey: 'gamification' });
    expect(draft.status).toBe(201);

    const list = await admin().get('/admin/add-ons');
    expect(list.status).toBe(200);
    expect((list.body.items as { key: string }[]).map((i) => i.key)).toEqual(expect.arrayContaining([ADDON_KEY, DRAFT_KEY]));

    const actions = (await prisma.auditLog.findMany({ where: { entityType: 'AddOn', entityId: addOnId }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['add_on.create', 'add_on.prices', 'add_on.update']));
  });

  it('only the super admin reaches the catalogue endpoints', async () => {
    expect((await owner('tr').get('/admin/add-ons')).status).toBe(403);
    expect((await owner('tr').post('/admin/add-ons').send({})).status).toBe(403);
    expect((await request(server).get('/admin/add-ons')).status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Tenant catalogue and permission
  // ---------------------------------------------------------------------------

  it('each tenant sees the catalogue with its own billing currency; a missing price is shown but not purchasable', async () => {
    const tr = await item('tr');
    expect(tr).toMatchObject({ state: 'AVAILABLE', hasAccess: false, purchasable: true, trialAvailable: true, price: { currency: 'TRY', priceMonthly: '199.00', priceYearly: '1990.00' } });
    const de = await item('de');
    expect(de.price).toEqual({ currency: 'EUR', priceMonthly: '9.00', priceYearly: '90.00' });
    const us = await item('us');
    expect(us).toMatchObject({ price: null, purchasable: false, purchaseBlockedReason: 'NO_PRICE_IN_CURRENCY', trialAvailable: false, state: 'AVAILABLE' });

    const res = await owner('tr').get(`${base('tr')}/add-ons`);
    expect(res.body.billingCurrency).toBe('TRY');
    expect((res.body.items as { key: string }[]).map((i) => i.key)).not.toContain(DRAFT_KEY);

    // The USD tenant can neither try nor buy it.
    const trial = await owner('us').post(`${base('us')}/add-ons/${ADDON_KEY}/start-trial`).send({});
    expect(trial.status).toBe(400);
    expect(trial.body.code).toBe('ADD_ON_PRICE_UNAVAILABLE');
    const buy = await owner('us').post(`${base('us')}/add-ons/${ADDON_KEY}/activate`).send({ interval: 'MONTH' });
    expect(buy.status).toBe(400);
    expect(buy.body.code).toBe('ADD_ON_PRICE_UNAVAILABLE');
    // Nothing was created for it.
    expect(await prisma.studioAddOn.count({ where: { studioId: tenants.us.studioId } })).toBe(0);

    // An unpublished add-on is not found by key.
    expect((await owner('tr').post(`${base('tr')}/add-ons/${DRAFT_KEY}/start-trial`).send({})).status).toBe(404);
  });

  it('billing.manage is owner-only: reception cannot list, try, buy or cancel, but can read the effective features', async () => {
    const reception = as(tenants.tr.receptionToken, tenants.tr.studioId);
    expect((await reception.get(`${base('tr')}/add-ons`)).status).toBe(403);
    expect((await reception.post(`${base('tr')}/add-ons/${ADDON_KEY}/start-trial`).send({})).status).toBe(403);
    expect((await reception.post(`${base('tr')}/add-ons/${ADDON_KEY}/activate`).send({ interval: 'MONTH' })).status).toBe(403);
    expect((await reception.post(`${base('tr')}/add-ons/${ADDON_KEY}/cancel`).send({})).status).toBe(403);
    const features = await reception.get(`${base('tr')}/features`);
    expect(features.status).toBe(200);
    expect(features.body.enabled).not.toContain(FLAG);
    // The flag is off and this add-on unlocks it: the empty state can point at it.
    expect(features.body.unlockableBy).toEqual(expect.arrayContaining([expect.objectContaining({ featureFlagKey: FLAG, addOnKey: ADDON_KEY })]));
  });

  it('a tenant cannot read another tenant catalogue state through its own studio id', async () => {
    const foreign = await request(server)
      .get(`/studios/${tenants.de.studioId}/add-ons`)
      .set('Authorization', `Bearer ${tenants.tr.ownerToken}`)
      .set('x-studio-id', tenants.de.studioId);
    expect([403, 404]).toContain(foreign.status);
  });

  // ---------------------------------------------------------------------------
  // Restricted mode
  // ---------------------------------------------------------------------------

  it('a restricted-mode tenant cannot start a trial or buy', async () => {
    const trial = await owner('restricted').post(`${base('restricted')}/add-ons/${ADDON_KEY}/start-trial`).send({});
    expect(trial.status).toBe(403);
    expect(trial.body.code).toBe('BILLING_RESTRICTED');
    const buy = await owner('restricted').post(`${base('restricted')}/add-ons/${ADDON_KEY}/activate`).send({ interval: 'MONTH' });
    expect(buy.status).toBe(403);
    expect(buy.body.code).toBe('BILLING_RESTRICTED');
    expect(await prisma.studioAddOn.count({ where: { studioId: tenants.restricted.studioId } })).toBe(0);
    // Reading the catalogue still works.
    expect((await owner('restricted').get(`${base('restricted')}/add-ons`)).status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Trial, activation, cancel, expiry
  // ---------------------------------------------------------------------------

  it('a trial starts once per tenant, turns the flag on for that tenant only and cannot be repeated', async () => {
    const started = await owner('tr').post(`${base('tr')}/add-ons/${ADDON_KEY}/start-trial`).send({});
    expect(started.status).toBe(200);
    expect(started.body.item).toMatchObject({ state: 'TRIALING', hasAccess: true, trialDaysLeft: 14, trialAvailable: false });
    const row = await prisma.studioAddOn.findFirstOrThrow({ where: { studioId: tenants.tr.studioId, addOnId } });
    expect(row.status).toBe('TRIALING');
    expect(Math.round((row.trialEndsAt!.getTime() - row.trialStartedAt!.getTime()) / DAY)).toBe(14);
    expect(row.priceSnapshot).toMatchObject({ currency: 'TRY', priceMonthly: '199.00', priceYearly: '1990.00', interval: null });

    expect(await enabledFlags('tr')).toContain(FLAG);
    // Other tenants are unaffected.
    expect(await enabledFlags('de')).not.toContain(FLAG);
    expect((await item('de')).state).toBe('AVAILABLE');

    const again = await owner('tr').post(`${base('tr')}/add-ons/${ADDON_KEY}/start-trial`).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ADD_ON_TRIAL_USED');
    expect(await prisma.studioAddOn.count({ where: { studioId: tenants.tr.studioId, addOnId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { studioId: tenants.tr.studioId, action: 'add_on.trial_start' } })).toBe(1);
  });

  it('activation charges the price in the tenant currency through the MOCK provider, converts the trial and keeps the flag on', async () => {
    const res = await owner('tr').post(`${base('tr')}/add-ons/${ADDON_KEY}/activate`).send({ interval: 'YEAR' });
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(false);
    expect(res.body.item).toMatchObject({ state: 'ACTIVE', hasAccess: true, billingInterval: 'YEAR', trialDaysLeft: null });

    const payment = await prisma.platformBillingPayment.findFirstOrThrow({ where: { studioId: tenants.tr.studioId, studioAddOn: { addOnId } } });
    expect(payment).toMatchObject({ planId: null, currency: 'TRY', status: 'COMPLETED', provider: 'MOCK', periodMonths: 12 });
    expect(payment.amount.toFixed(2)).toBe('1990.00');
    expect(payment.creditAmount.toFixed(2)).toBe('0.00');

    const row = await prisma.studioAddOn.findFirstOrThrow({ where: { studioId: tenants.tr.studioId, addOnId } });
    expect(row).toMatchObject({ status: 'ACTIVE', billingInterval: 'YEAR', renewalFailures: 0 });
    expect(row.activatedAt).not.toBeNull();
    const yearMs = row.currentPeriodEnd!.getTime() - row.activatedAt!.getTime();
    expect(yearMs / DAY).toBeGreaterThanOrEqual(365);
    expect(yearMs / DAY).toBeLessThanOrEqual(366);
    expect(row.priceSnapshot).toMatchObject({ currency: 'TRY', interval: 'YEAR', amount: '1990.00' });
    expect(await enabledFlags('tr')).toContain(FLAG);
    expect(await prisma.auditLog.count({ where: { studioId: tenants.tr.studioId, action: 'add_on.activate' } })).toBe(1);

    // The payment list shows the add-on line and no plan.
    const payments = await owner('tr').get(`${base('tr')}/billing/payments`);
    expect(payments.status).toBe(200);
    const line = (payments.body.items as { planKey: string | null; addOn: { key: string } | null; amount: string; currency: string }[]).find((p) => p.addOn?.key === ADDON_KEY);
    expect(line).toMatchObject({ planKey: null, amount: '1990.00', currency: 'TRY' });

    // Active add-ons cannot be bought twice, and no referral credit is touched.
    const twice = await owner('tr').post(`${base('tr')}/add-ons/${ADDON_KEY}/activate`).send({ interval: 'MONTH' });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('ADD_ON_ALREADY_ACTIVE');
    expect(await prisma.platformCreditLedger.count({ where: { studioId: tenants.tr.studioId } })).toBe(0);
  });

  it('cancel keeps access until the period end and the heartbeat then expires it and turns the module off', async () => {
    const res = await owner('tr').post(`${base('tr')}/add-ons/${ADDON_KEY}/cancel`).send({});
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ state: 'CANCELLED', hasAccess: true });
    const row = await prisma.studioAddOn.findFirstOrThrow({ where: { studioId: tenants.tr.studioId, addOnId } });
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelledAt).not.toBeNull();
    expect(await enabledFlags('tr')).toContain(FLAG);

    const twice = await owner('tr').post(`${base('tr')}/add-ons/${ADDON_KEY}/cancel`).send({});
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('ADD_ON_NOT_CANCELLABLE');

    // Before the period end the heartbeat leaves it alone.
    const early = await addOnJobs.run(new Date(row.currentPeriodEnd!.getTime() - DAY));
    expect(early.expired).toBe(0);
    expect((await prisma.studioAddOn.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('CANCELLED');

    // Past the period end it expires; the flag is off at once because the resolver reads the period, and the row follows.
    await prisma.studioAddOn.update({ where: { id: row.id }, data: { currentPeriodEnd: new Date(Date.now() - 60_000) } });
    expect(await enabledFlags('tr')).not.toContain(FLAG);
    const late = await billingJobs.run(new Date());
    expect(late.addOns.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.studioAddOn.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('EXPIRED');
    expect(await prisma.auditLog.count({ where: { studioId: tenants.tr.studioId, action: 'add_on.expired' } })).toBe(1);
    expect((await item('tr')).state).toBe('EXPIRED');

    // The trial is used up, but the tenant may buy again.
    expect((await owner('tr').post(`${base('tr')}/add-ons/${ADDON_KEY}/start-trial`).send({})).status).toBe(409);
  });

  it('a failed first purchase leaves the trial unused; the trial notice goes out once, the ended trial expires', async () => {
    const failing = jest.spyOn(mock, 'createCheckout').mockRejectedValueOnce(new Error('provider down'));
    const failed = await owner('de').post(`${base('de')}/add-ons/${ADDON_KEY}/activate`).send({ interval: 'MONTH' });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    failing.mockRestore();
    const failedPayment = await prisma.platformBillingPayment.findFirstOrThrow({ where: { studioId: tenants.de.studioId } });
    expect(failedPayment.status).toBe('FAILED');
    expect(await enabledFlags('de')).not.toContain(FLAG);
    expect(await item('de')).toMatchObject({ state: 'AVAILABLE', trialAvailable: true });

    const started = await owner('de').post(`${base('de')}/add-ons/${ADDON_KEY}/start-trial`).send({});
    expect(started.status).toBe(200);
    expect(await enabledFlags('de')).toContain(FLAG);

    const row = await prisma.studioAddOn.findFirstOrThrow({ where: { studioId: tenants.de.studioId, addOnId } });
    // 10 days left: no notice yet.
    await prisma.studioAddOn.update({ where: { id: row.id }, data: { trialEndsAt: new Date(Date.now() + 10 * DAY) } });
    expect(await addOnJobs.sendTrialReminders(new Date())).toBe(0);
    // 2 days left: one notice, and only one.
    await prisma.studioAddOn.update({ where: { id: row.id }, data: { trialEndsAt: new Date(Date.now() + 2 * DAY) } });
    expect(await addOnJobs.sendTrialReminders(new Date())).toBe(1);
    expect(await addOnJobs.sendTrialReminders(new Date())).toBe(0);
    expect((await prisma.studioAddOn.findUniqueOrThrow({ where: { id: row.id } })).trialReminderSentAt).not.toBeNull();
    const notice = await prisma.notificationLog.count({ where: { studioId: tenants.de.studioId, type: 'ADDON_TRIAL_ENDING' } });
    expect(notice).toBeGreaterThanOrEqual(1);

    // Trial over: the flag goes off at once and the heartbeat marks the row EXPIRED.
    await prisma.studioAddOn.update({ where: { id: row.id }, data: { trialEndsAt: new Date(Date.now() - 60_000) } });
    expect(await enabledFlags('de')).not.toContain(FLAG);
    await addOnJobs.run(new Date());
    expect((await prisma.studioAddOn.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('EXPIRED');
    expect((await item('de')).state).toBe('EXPIRED');
  });

  it('a hosted checkout is completed by the provider webhook through the shared URL', async () => {
    // The trial of "de" is over; buying starts a checkout the provider confirms later.
    const reference = `mock_chk_${randomUUID()}`;
    const row = await prisma.studioAddOn.findFirstOrThrow({ where: { studioId: tenants.de.studioId, addOnId } });
    await prisma.platformBillingPayment.create({
      data: {
        studioId: tenants.de.studioId,
        planId: null,
        studioAddOnId: row.id,
        listAmount: '9.00',
        amount: '9.00',
        currency: 'EUR',
        periodMonths: 1,
        status: 'PENDING',
        provider: 'MOCK',
        providerReference: reference,
      },
    });
    // A pending payment blocks a second checkout for the same add-on.
    const blocked = await owner('de').post(`${base('de')}/add-ons/${ADDON_KEY}/activate`).send({ interval: 'MONTH' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('ADD_ON_PAYMENT_PENDING');

    const body = JSON.stringify({ eventType: 'CHECKOUT_COMPLETED', providerReference: reference, amount: 9 });
    const hook = await request(server).post('/payments/webhook/mock').set('Content-Type', 'application/json').set('x-mock-signature', MockPaymentProvider.sign(body)).send(body);
    expect(hook.status).toBe(200);
    expect(hook.body).toMatchObject({ handled: true });
    expect(await item('de')).toMatchObject({ state: 'ACTIVE', hasAccess: true, billingInterval: 'MONTH' });
    expect(await enabledFlags('de')).toContain(FLAG);
    const again = await request(server).post('/payments/webhook/mock').set('Content-Type', 'application/json').set('x-mock-signature', MockPaymentProvider.sign(body)).send(body);
    expect(again.body).toMatchObject({ alreadyProcessed: true });
    expect(await prisma.platformBillingPayment.count({ where: { providerReference: reference, status: 'COMPLETED' } })).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Renewal and dunning
  // ---------------------------------------------------------------------------

  it('renewal charges the quoted price monthly; failures retry after 1, 3 and 5 days and then expire the add-on', async () => {
    // "tr" buys monthly again (expired earlier), then the period is made due.
    const buy = await owner('tr').post(`${base('tr')}/add-ons/${ADDON_KEY}/activate`).send({ interval: 'MONTH' });
    expect(buy.status).toBe(200);
    const row = await prisma.studioAddOn.findFirstOrThrow({ where: { studioId: tenants.tr.studioId, addOnId } });
    expect(row.status).toBe('ACTIVE');

    // Price change in the catalogue does not touch a running subscription: renewal uses the snapshot.
    await admin()
      .put(`/admin/add-ons/${addOnId}/prices`)
      .send({
        prices: [
          { currency: 'TRY', priceMonthly: 299, priceYearly: 2990 },
          { currency: 'EUR', priceMonthly: 9, priceYearly: 90 },
        ],
      });

    const due = new Date(Date.now() - 60_000);
    await prisma.studioAddOn.update({ where: { id: row.id }, data: { currentPeriodEnd: due } });
    const ok = await addOnJobs.run(new Date());
    expect(ok.renewed).toBeGreaterThanOrEqual(1);
    const renewed = await prisma.studioAddOn.findUniqueOrThrow({ where: { id: row.id } });
    expect(renewed.status).toBe('ACTIVE');
    expect(renewed.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 27 * DAY);
    const renewalPayment = await prisma.platformBillingPayment.findFirstOrThrow({ where: { studioAddOnId: row.id, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
    expect(renewalPayment.amount.toFixed(2)).toBe('199.00');
    expect(renewalPayment.currency).toBe('TRY');
    expect(await prisma.auditLog.count({ where: { studioId: tenants.tr.studioId, action: 'add_on.renew' } })).toBe(1);

    // Dunning: every attempt fails.
    jest.spyOn(mock, 'createCheckout').mockRejectedValue(new Error('card declined'));
    await prisma.studioAddOn.update({ where: { id: row.id }, data: { currentPeriodEnd: due } });
    const t0 = new Date();
    const first = await addOnJobs.run(t0);
    expect(first.failed).toBeGreaterThanOrEqual(1);
    let now = await prisma.studioAddOn.findUniqueOrThrow({ where: { id: row.id } });
    expect(now).toMatchObject({ status: 'ACTIVE', renewalFailures: 1 });
    expect(Math.round((now.nextRenewalAttemptAt!.getTime() - t0.getTime()) / DAY)).toBe(1);
    // Access continues while retries are pending.
    expect(await enabledFlags('tr')).toContain(FLAG);
    const notices = () => prisma.notificationLog.count({ where: { studioId: tenants.tr.studioId, type: 'ADDON_RENEWAL_FAILED' } });
    expect(await notices()).toBeGreaterThanOrEqual(1);
    expect((await item('tr')).paymentOverdue).toBe(true);

    // Not due again yet: no new attempt.
    const idle = await addOnJobs.run(new Date(t0.getTime() + 60 * 60 * 1000));
    expect(idle.failed).toBe(0);
    expect((await prisma.studioAddOn.findUniqueOrThrow({ where: { id: row.id } })).renewalFailures).toBe(1);

    const t1 = new Date(t0.getTime() + DAY + 60_000);
    await addOnJobs.run(t1);
    now = await prisma.studioAddOn.findUniqueOrThrow({ where: { id: row.id } });
    expect(now.renewalFailures).toBe(2);
    expect(Math.round((now.nextRenewalAttemptAt!.getTime() - t1.getTime()) / DAY)).toBe(3);

    const t2 = new Date(t1.getTime() + 3 * DAY + 60_000);
    await addOnJobs.run(t2);
    now = await prisma.studioAddOn.findUniqueOrThrow({ where: { id: row.id } });
    expect(now.renewalFailures).toBe(3);
    expect(Math.round((now.nextRenewalAttemptAt!.getTime() - t2.getTime()) / DAY)).toBe(5);

    const t3 = new Date(t2.getTime() + 5 * DAY + 60_000);
    await addOnJobs.run(t3);
    now = await prisma.studioAddOn.findUniqueOrThrow({ where: { id: row.id } });
    expect(now.status).toBe('EXPIRED');
    expect(await enabledFlags('tr')).not.toContain(FLAG);
    expect(await prisma.platformBillingPayment.count({ where: { studioAddOnId: row.id, status: 'FAILED' } })).toBe(4);

    jest.restoreAllMocks();
    mock = app.get(PaymentProviderRegistry).default as MockPaymentProvider;
  });

  // ---------------------------------------------------------------------------
  // Revenue per currency
  // ---------------------------------------------------------------------------

  it('add-on revenue is listed per currency and never summed across currencies', async () => {
    const res = await admin().get('/admin/add-ons/revenue');
    expect(res.status).toBe(200);
    const items = res.body.items as { currency: string; amount: string; payments: number }[];
    const currencies = items.map((i) => i.currency);
    expect(new Set(currencies).size).toBe(currencies.length);
    expect(currencies).toEqual(expect.arrayContaining(['TRY', 'EUR']));
    for (const entry of items) {
      const rows = await prisma.platformBillingPayment.findMany({ where: { studioAddOnId: { not: null }, status: 'COMPLETED', currency: entry.currency }, select: { amount: true } });
      const sum = rows.reduce((acc, r) => acc + Number(r.amount), 0);
      expect(Number(entry.amount)).toBeCloseTo(sum, 2);
      expect(entry.payments).toBe(rows.length);
    }
    // Only add-on payments count: plan payments of the same tenants do not appear.
    const tenantCount = (await admin().get('/admin/add-ons')).body.items.find((i: { key: string }) => i.key === ADDON_KEY).tenantCount as number;
    expect(tenantCount).toBe(1); // "de" is ACTIVE, "tr" expired
  });
});
