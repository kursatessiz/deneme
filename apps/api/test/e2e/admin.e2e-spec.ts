import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { FeatureFlagsService } from '../../src/modules/admin/feature-flags.service';

/**
 * Backlog 4.1-4.3: super-admin (platform owner) panel. Covers the security
 * requirement (every /admin/* route family rejects a non-super-admin with
 * 403 through the single SuperAdminGuard), tenant create/suspend/reactivate
 * and the suspension actually blocking staff studio access, feature flag
 * resolution precedence, benchmark k-anonymity suppression, and the SMS
 * wallet top-up being audit-logged. Everything created here is removed in
 * afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';

interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

describe('Admin (super-admin) panel e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;
  let featureFlags: FeatureFlagsService;

  let superAdminToken: string;
  let ownerToken: string;
  let trainerToken: string;
  let trainerUserId: string;

  let ZEN: string;
  let businessTypeKey: string;
  let planKey: string;

  const createdStudioIds: string[] = [];
  const createdPlanKeys: string[] = [];
  const createdSmsPackageKeys: string[] = [];
  const createdBusinessTypeKeys: string[] = [];
  const createdFeatureFlagIds: string[] = [];
  const createdMessageTemplateIds: string[] = [];
  const createdDocumentVersionIds: string[] = [];
  const createdMembershipIds: string[] = [];
  const createdAuditLogIds: string[] = [];

  const login = async (phone: string): Promise<LoginResult> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body as LoginResult;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    featureFlags = moduleRef.get(FeatureFlagsService);

    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = zen.id;
    const businessType = await prisma.businessTypeTemplate.findFirstOrThrow({ where: { key: 'pilates_studio' } });
    businessTypeKey = businessType.key;
    const plan = await prisma.plan.findFirstOrThrow({ where: { key: 'starter' } });
    planKey = plan.key;

    superAdminToken = (await login(SUPER_ADMIN_PHONE)).accessToken;
    ownerToken = (await login(OWNER_PHONE)).accessToken;
    const trainerLogin = await login(TRAINER_PHONE);
    trainerToken = trainerLogin.accessToken;
    const trainerUser = await prisma.user.findUniqueOrThrow({ where: { phone: TRAINER_PHONE } });
    trainerUserId = trainerUser.id;
  });

  afterAll(async () => {
    if (createdMembershipIds.length) {
      await prisma.membership.deleteMany({ where: { id: { in: createdMembershipIds } } });
    }
    if (createdAuditLogIds.length) {
      await prisma.auditLog.deleteMany({ where: { id: { in: createdAuditLogIds } } });
    }
    if (createdMessageTemplateIds.length) {
      await prisma.messageTemplate.deleteMany({ where: { id: { in: createdMessageTemplateIds } } });
    }
    if (createdDocumentVersionIds.length) {
      await prisma.consent.deleteMany({ where: { documentVersionId: { in: createdDocumentVersionIds } } });
      await prisma.documentVersion.deleteMany({ where: { id: { in: createdDocumentVersionIds } } });
    }
    if (createdFeatureFlagIds.length) {
      await prisma.featureFlag.deleteMany({ where: { id: { in: createdFeatureFlagIds } } });
    }
    for (const studioId of createdStudioIds) {
      await prisma.subscription.deleteMany({ where: { studioId } });
      await prisma.inviteToken.deleteMany({ where: { studioId } });
      await prisma.roleTemplatePermission.deleteMany({ where: { roleTemplate: { studioId } } });
      await prisma.membership.deleteMany({ where: { studioId } });
      await prisma.roleTemplate.deleteMany({ where: { studioId } });
      await prisma.auditLog.deleteMany({ where: { studioId } });
      await prisma.studio.delete({ where: { id: studioId } });
    }
    if (createdSmsPackageKeys.length) {
      await prisma.smsPackage.deleteMany({ where: { key: { in: createdSmsPackageKeys } } });
    }
    if (createdBusinessTypeKeys.length) {
      await prisma.businessTypeTemplate.deleteMany({ where: { key: { in: createdBusinessTypeKeys } } });
    }
    if (createdPlanKeys.length) {
      const testPlans = await prisma.plan.findMany({ where: { key: { in: createdPlanKeys } }, select: { id: true } });
      await prisma.subscription.deleteMany({ where: { planId: { in: testPlans.map((p) => p.id) } } });
      await prisma.plan.deleteMany({ where: { key: { in: createdPlanKeys } } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  describe('security: every /admin/* route family requires a super admin', () => {
    const routes: { method: 'get' | 'post'; path: string }[] = [
      { method: 'get', path: '/admin/tenants' },
      { method: 'post', path: '/admin/tenants' },
      { method: 'get', path: '/admin/plans' },
      { method: 'post', path: '/admin/plans' },
      { method: 'get', path: '/admin/business-type-templates' },
      { method: 'get', path: '/admin/feature-flags' },
      { method: 'post', path: '/admin/feature-flags' },
      { method: 'get', path: '/admin/sms-packages' },
      { method: 'get', path: '/admin/content/message-templates' },
      { method: 'get', path: '/admin/content/document-versions' },
      { method: 'get', path: '/admin/benchmark' },
      { method: 'get', path: '/admin/health' },
      { method: 'post', path: '/admin/scheduler/run' },
      { method: 'post', path: '/admin/dunning/run' },
      { method: 'post', path: '/admin/churn/recompute-all' },
      { method: 'post', path: '/sms-wallet/top-up' },
    ];

    it.each(routes)('rejects a non-super-admin on $method $path with 403', async ({ method, path }) => {
      const res = await request(server)[method](path).set('Authorization', `Bearer ${ownerToken}`).send({});
      expect(res.status).toBe(403);
    });

    it('rejects an unauthenticated caller with 401', async () => {
      const res = await request(server).get('/admin/tenants');
      expect(res.status).toBe(401);
    });
  });

  describe('tenant create / suspend / reactivate', () => {
    let newStudioId: string;

    it('creates a tenant with default role templates, a trial subscription and an owner invite', async () => {
      const res = await request(server)
        .post('/admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'E2E Test Studyosu',
          slug: `e2e-test-studyosu-${Date.now()}`,
          businessTypeTemplateKey: businessTypeKey,
          planKey,
          ownerFirstName: 'Test',
          ownerLastName: 'Sahip',
          ownerPhone: '+905321099001',
          ownerChannel: 'SHOWN',
        });
      expect(res.status).toBe(201);
      expect(res.body.studioId).toBeTruthy();
      expect(res.body.ownerInvite.inviteUrl).toContain('/j/');
      newStudioId = res.body.studioId;
      createdStudioIds.push(newStudioId);

      const roleTemplates = await prisma.roleTemplate.findMany({ where: { studioId: newStudioId } });
      expect(roleTemplates.map((r) => r.key).sort()).toEqual(['member', 'owner', 'reception', 'trainer'].sort());

      const subscription = await prisma.subscription.findFirstOrThrow({ where: { studioId: newStudioId } });
      expect(subscription.status).toBe('TRIALING');
    });

    it('appears in the tenant list and detail endpoints', async () => {
      const list = await request(server).get('/admin/tenants').set('Authorization', `Bearer ${superAdminToken}`);
      expect(list.status).toBe(200);
      expect(list.body.items.some((t: { id: string }) => t.id === newStudioId)).toBe(true);

      const detail = await request(server)
        .get(`/admin/tenants/${newStudioId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.isActive).toBe(true);
    });

    it('suspending the tenant blocks a staff member from that studio context, reactivating restores it', async () => {
      // Give the trainer test user a membership at the new tenant so we can
      // exercise StudioTenantGuard's isActive check with a real token.
      const ownerRole = await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: newStudioId, key: 'owner' } });
      const membership = await prisma.membership.create({
        data: { userId: trainerUserId, studioId: newStudioId, roleTemplateId: ownerRole.id, status: 'ACTIVE', joinedAt: new Date() },
      });
      createdMembershipIds.push(membership.id);

      const beforeSuspend = await request(server)
        .get(`/studios/${newStudioId}/metrics`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .set('x-studio-id', newStudioId);
      expect(beforeSuspend.status).toBe(200);

      const suspend = await request(server)
        .post(`/admin/tenants/${newStudioId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(suspend.status).toBe(201);
      expect(suspend.body.isActive).toBe(false);

      const afterSuspend = await request(server)
        .get(`/studios/${newStudioId}/metrics`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .set('x-studio-id', newStudioId);
      expect(afterSuspend.status).toBe(403);

      const reactivate = await request(server)
        .post(`/admin/tenants/${newStudioId}/reactivate`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(reactivate.status).toBe(201);
      expect(reactivate.body.isActive).toBe(true);

      const afterReactivate = await request(server)
        .get(`/studios/${newStudioId}/metrics`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .set('x-studio-id', newStudioId);
      expect(afterReactivate.status).toBe(200);
    });
  });

  describe('feature flags: resolution precedence', () => {
    const FLAG_KEY = `e2e_test_flag_${Date.now()}`;

    it('TENANT overrides BUSINESS_TYPE overrides GLOBAL', async () => {
      await expect(featureFlags.isFeatureEnabled(ZEN, FLAG_KEY)).resolves.toBe(false);

      const global = await request(server)
        .post('/admin/feature-flags')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ key: FLAG_KEY, scope: 'GLOBAL', enabled: true });
      expect(global.status).toBe(201);
      createdFeatureFlagIds.push(global.body.id);
      await expect(featureFlags.isFeatureEnabled(ZEN, FLAG_KEY)).resolves.toBe(true);

      const zenStudio = await prisma.studio.findUniqueOrThrow({ where: { id: ZEN }, select: { businessTypeTemplateId: true } });
      const businessType = await request(server)
        .post('/admin/feature-flags')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ key: FLAG_KEY, scope: 'BUSINESS_TYPE', businessTypeTemplateId: zenStudio.businessTypeTemplateId, enabled: false });
      expect(businessType.status).toBe(201);
      createdFeatureFlagIds.push(businessType.body.id);
      await expect(featureFlags.isFeatureEnabled(ZEN, FLAG_KEY)).resolves.toBe(false);

      const tenant = await request(server)
        .post('/admin/feature-flags')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ key: FLAG_KEY, scope: 'TENANT', studioId: ZEN, enabled: true });
      expect(tenant.status).toBe(201);
      createdFeatureFlagIds.push(tenant.body.id);
      await expect(featureFlags.isFeatureEnabled(ZEN, FLAG_KEY)).resolves.toBe(true);
    });
  });

  describe('benchmark: k-anonymity suppression', () => {
    it('suppresses every bucket in the seeded dataset (each business type has fewer than 5 studios)', async () => {
      const res = await request(server).get('/admin/benchmark').set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.buckets.length).toBeGreaterThan(0);
      for (const bucket of res.body.buckets) {
        expect(bucket.studioCount).toBeLessThan(5);
        expect(bucket.suppressed).toBe(true);
        expect(bucket.avgOccupancyRate).toBeNull();
        expect(bucket.avgRevenuePerMember).toBeNull();
      }
    });
  });

  describe('SMS wallet top-up is audit-logged', () => {
    it('records an audit log entry with the super admin as actor', async () => {
      const before = await prisma.auditLog.count({ where: { studioId: ZEN, action: 'sms_wallet.top_up' } });

      const res = await request(server)
        .post('/sms-wallet/top-up')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ studioId: ZEN, credits: 50, note: 'e2e test top-up' });
      expect(res.status).toBe(201);

      const entries = await prisma.auditLog.findMany({
        where: { studioId: ZEN, action: 'sms_wallet.top_up' },
        orderBy: { createdAt: 'desc' },
      });
      expect(entries.length).toBe(before + 1);
      const latest = entries[0];
      expect(latest.userId).toBe((await prisma.user.findUniqueOrThrow({ where: { phone: SUPER_ADMIN_PHONE } })).id);
      createdAuditLogIds.push(latest.id);

      // Roll back the balance change the top-up made, so the suite stays repeatable.
      await prisma.smsWallet.update({ where: { studioId: ZEN }, data: { balance: { decrement: 50 } } });
      await prisma.smsTransaction.delete({ where: { id: res.body.transaction.id } });
    });
  });

  describe('plans, business type templates and SMS packages CRUD', () => {
    it('upserts a plan, a business type template and an SMS package', async () => {
      const planKeyLocal = `e2e_plan_${Date.now()}`;
      const plan = await request(server)
        .post('/admin/plans')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ key: planKeyLocal, name: 'E2E Plan', priceMonthly: 999, limits: { maxActiveMembers: 3 }, isActive: true });
      expect(plan.status).toBe(201);
      createdPlanKeys.push(planKeyLocal);

      const btKey = `e2e_business_type_${Date.now()}`;
      const businessType = await request(server)
        .post('/admin/business-type-templates')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          key: btKey,
          name: 'E2E Isletme Turu',
          vocabulary: { member: 'Uye' },
          defaults: { serviceTypeNames: ['Test Hizmeti'], resourceTypeNames: ['Test Alani'] },
          enabledModules: ['scheduling'],
          isActive: true,
        });
      expect(businessType.status).toBe(201);
      createdBusinessTypeKeys.push(btKey);

      const smsKey = `e2e_sms_${Date.now()}`;
      const smsPackage = await request(server)
        .post('/admin/sms-packages')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ key: smsKey, name: 'E2E SMS Paketi', credits: 100, price: 50, isActive: true });
      expect(smsPackage.status).toBe(201);
      createdSmsPackageKeys.push(smsKey);
    });
  });

  describe('plan limit enforcement', () => {
    it('returns 402 when a tenant tries to exceed its plan member limit', async () => {
      const currentActiveMembers = await prisma.membership.count({
        where: { studioId: ZEN, status: 'ACTIVE', memberProfile: { isNot: null } },
      });
      const tightPlanKey = `e2e_tight_plan_${Date.now()}`;
      await request(server)
        .post('/admin/plans')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          key: tightPlanKey,
          name: 'Tight Plan',
          priceMonthly: 0,
          limits: { maxActiveMembers: currentActiveMembers },
          isActive: true,
        })
        .expect(201);
      createdPlanKeys.push(tightPlanKey);

      const assign = await request(server)
        .post(`/admin/tenants/${ZEN}/plan`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ planKey: tightPlanKey });
      expect(assign.status).toBe(201);

      const createMember = await request(server)
        .post('/members')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, firstName: 'Limit', lastName: 'Test', phone: '+905321099002' });
      expect(createMember.status).toBe(402);

      // Restore Zen to an unlimited (no active limits) plan-less state? Not
      // possible via API (no "remove subscription" endpoint by design -
      // CLAUDE.md keeps subscriptions append-only); instead assign back the
      // Pro plan Zen was seeded with so later-run specs are unaffected.
      const proPlan = await prisma.plan.findFirstOrThrow({ where: { key: 'pro' } });
      await request(server)
        .post(`/admin/tenants/${ZEN}/plan`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ planKey: proPlan.key })
        .expect(201);
    });
  });
});
