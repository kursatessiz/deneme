import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { UsagePeriodsJobsService } from '../../src/modules/usage-periods/usage-periods-jobs.service';

/**
 * Usage periods (docs/KULLANIM_DONEMLERI.md): the owner-only studio switch, a package definition rule
 * (month quota 2 that burns + week cap 1), the snapshot taken at sale time, enforcement on booking and the
 * "switch off ignores every rule" behaviour. The suite owns its service type and package definition and
 * restores the studio switch afterwards.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const HOUR = 3600_000;

const RULE = {
  version: 1,
  tiers: [
    { unit: 'MONTH', length: 1, monthMode: 'CALENDAR', quota: 2, expireUnused: true },
    { unit: 'WEEK', length: 1, quota: 1, expireUnused: false },
  ],
  reminderDaysBefore: 3,
};

describe('Usage periods (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;

  let ZEN: string;
  let ownerToken: string;
  let receptionToken: string;
  let receptionRoleId: string;
  let originalSwitch: boolean;
  let grantedSettingsPermission = false;

  let serviceTypeId: string;
  let definitionId: string;
  let memberId: string;
  const scheduleIds: string[] = [];
  const packageIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
  });

  const makeSchedule = async (offsetHours: number) => {
    const start = new Date(Date.now() + offsetHours * HOUR);
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        serviceTypeId,
        title: 'E2E kullanim donemi',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity: 3,
      },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  const sell = async () => {
    const res = await as(ownerToken)
      .post('/members/packages/assign')
      .send({ studioId: ZEN, memberId, packageDefinitionId: definitionId, paymentMethod: 'CASH', paidAmount: 0 });
    expect(res.status).toBe(201);
    packageIds.push(res.body.id);
    return res.body.id as string;
  };

  const book = (scheduleId: string, extra: Record<string, unknown> = {}) =>
    as(ownerToken).post('/schedules/book').send({ studioId: ZEN, scheduleId, memberId, ...extra });

  const setSwitch = async (enabled: boolean) => {
    const res = await as(ownerToken).put(`/studios/${ZEN}/usage-periods`).send({ enabled });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled });
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    const studio = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = studio.id;
    originalSwitch = studio.usagePeriodsEnabled;
    await prisma.studio.update({ where: { id: ZEN }, data: { usagePeriodsEnabled: false } });

    ownerToken = await login(OWNER_PHONE);
    receptionToken = await login(RECEPTION_PHONE);
    receptionRoleId = (await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId: ZEN, key: 'reception' } } })).id;
    // A non-owner who holds studio.settings.manage: the owner check must still answer 403.
    const had = await prisma.roleTemplatePermission.findFirst({ where: { roleTemplateId: receptionRoleId, permissionKey: 'studio.settings.manage' } });
    if (!had) {
      await prisma.roleTemplatePermission.create({ data: { roleTemplateId: receptionRoleId, permissionKey: 'studio.settings.manage' } });
      grantedSettingsPermission = true;
    }
    receptionToken = await login(RECEPTION_PHONE);

    const suffix = Date.now().toString(36);
    serviceTypeId = (
      await prisma.serviceType.create({
        data: { studioId: ZEN, name: `E2E donem hizmet ${suffix}`, durationMin: 60, capacity: 3, allowedEntitlementKinds: ['SESSION_COUNT'] },
      })
    ).id;
    definitionId = (
      await prisma.packageDefinition.create({
        data: {
          studioId: ZEN,
          name: `E2E donem paketi ${suffix}`,
          entitlementKind: 'SESSION_COUNT',
          totalUnits: 8,
          validityDays: 90,
          price: 0,
          services: { create: { serviceTypeId, unitCost: 1 } },
        },
      })
    ).id;
    memberId = (await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN }, orderBy: { id: 'desc' } })).id;
  });

  afterAll(async () => {
    await prisma.bookingResource.deleteMany({ where: { booking: { scheduleId: { in: scheduleIds } } } });
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.payment.deleteMany({ where: { memberPackageId: { in: packageIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.packageDefinition.deleteMany({ where: { id: definitionId } });
    await prisma.serviceType.deleteMany({ where: { id: serviceTypeId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: ZEN, action: { startsWith: 'studio.usagePeriods.' } }, { entityId: definitionId }] } });
    if (grantedSettingsPermission) {
      await prisma.roleTemplatePermission.deleteMany({ where: { roleTemplateId: receptionRoleId, permissionKey: 'studio.settings.manage' } });
    }
    await prisma.studio.update({ where: { id: ZEN }, data: { usagePeriodsEnabled: originalSwitch } });
    await prisma.$disconnect();
    await app.close();
  });

  it('answers 403 to a non-owner with the settings permission, and the switch stays off', async () => {
    const read = await as(receptionToken).get(`/studios/${ZEN}/usage-periods`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ enabled: false });

    const denied = await as(receptionToken).put(`/studios/${ZEN}/usage-periods`).send({ enabled: true });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('apiErrors.studios.onlyOwnerCanChangeUsagePeriods');
    expect((await prisma.studio.findUniqueOrThrow({ where: { id: ZEN } })).usagePeriodsEnabled).toBe(false);
  });

  it('a sale while the switch is off carries no snapshot, even when the definition has a rule', async () => {
    const set = await as(ownerToken).patch(`/catalog/package-definitions/${definitionId}/usage-rule`).send({ usageRule: RULE });
    expect(set.status).toBe(200);
    const packageId = await sell();
    expect((await prisma.memberPackage.findUniqueOrThrow({ where: { id: packageId } })).usageRule).toBeNull();
    await prisma.memberPackage.update({ where: { id: packageId }, data: { status: 'EXPIRED' } });
  });

  it('the owner enables the switch and the change is audited', async () => {
    await setSwitch(true);
    const audit = await prisma.auditLog.findFirst({ where: { studioId: ZEN, entityId: ZEN, action: 'studio.usagePeriods.enable' } });
    expect(audit).not.toBeNull();
  });

  it('rejects an invalid rule (finer quota above the coarser one) with a validation error', async () => {
    const res = await as(ownerToken)
      .patch(`/catalog/package-definitions/${definitionId}/usage-rule`)
      .send({
        usageRule: {
          version: 1,
          tiers: [
            { unit: 'MONTH', length: 1, monthMode: 'CALENDAR', quota: 2, expireUnused: true },
            { unit: 'WEEK', length: 1, quota: 5, expireUnused: false },
          ],
        },
      });
    expect(res.status).toBe(400);
  });

  describe('with the switch on', () => {
    let packageId: string;
    let first: string;
    let second: string;

    it('snapshots the rule on the member package at sale time', async () => {
      packageId = await sell();
      const row = await prisma.memberPackage.findUniqueOrThrow({ where: { id: packageId } });
      expect(row.usageRule).toMatchObject({ version: 1, reminderDaysBefore: 3 });
      expect((row.usageRule as { tiers: unknown[] }).tiers).toEqual(RULE.tiers);
    });

    it('lets the first session of the week through and refuses the second with the period quota error', async () => {
      first = await makeSchedule(48);
      second = await makeSchedule(72);
      const ok = await book(first, { memberPackageId: packageId });
      expect(ok.status).toBe(201);
      expect(ok.body.chargedPackage).toMatchObject({ memberPackageId: packageId, remainingUnits: 7 });

      const refused = await book(second, { memberPackageId: packageId });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('apiErrors.schedules.periodQuotaReached');
      expect(refused.body.params).toEqual(expect.objectContaining({ period: expect.any(String), date: expect.any(String) }));
      expect((await prisma.memberPackage.findUniqueOrThrow({ where: { id: packageId } })).remainingUnits).toBe(7);

      // Without naming a package the same error is raised: the member's only package is full for that week.
      const auto = await book(second);
      expect(auto.status).toBe(400);
      expect(auto.body.code).toBe('apiErrors.schedules.periodQuotaReached');
    });

    it('shows the current period of each tier on the staff member card', async () => {
      const res = await as(ownerToken).get(`/members/${memberId}/studio/${ZEN}`);
      expect(res.status).toBe(200);
      const pkg = res.body.packages.find((p: { id: string }) => p.id === packageId);
      const week = pkg.usagePeriods.find((p: { unit: string }) => p.unit === 'WEEK');
      const month = pkg.usagePeriods.find((p: { unit: string }) => p.unit === 'MONTH');
      expect(week).toMatchObject({ quota: 1, used: 1, remaining: 0, expireUnused: false });
      expect(month).toMatchObject({ quota: 2, used: 1, remaining: 1, expireUnused: true });
      expect(pkg.expiredUnits).toBe(0);
    });

    it('a free cancellation gives the week quota back', async () => {
      const booking = await prisma.booking.findFirstOrThrow({ where: { scheduleId: first, memberId } });
      const cancel = await as(ownerToken).post('/schedules/cancel').send({ studioId: ZEN, bookingId: booking.id, cancelledBy: 'STUDIO' });
      expect(cancel.status).toBe(201);
      const retry = await book(second, { memberPackageId: packageId });
      expect(retry.status).toBe(201);
    });

    it('turning the switch off lifts the quota for sold packages too', async () => {
      await setSwitch(false);
      const third = await makeSchedule(50);
      const res = await book(third, { memberPackageId: packageId });
      expect(res.status).toBe(201);
      const card = await as(ownerToken).get(`/members/${memberId}/studio/${ZEN}`);
      const pkg = card.body.packages.find((p: { id: string }) => p.id === packageId);
      expect(pkg.usagePeriods).toBeNull();
      expect(await prisma.auditLog.findFirst({ where: { studioId: ZEN, entityId: ZEN, action: 'studio.usagePeriods.disable' } })).not.toBeNull();
    });

    it('later edits of the definition rule do not change a package that was already sold', async () => {
      await setSwitch(true);
      const edited = {
        version: 1,
        tiers: [
          { unit: 'MONTH', length: 1, monthMode: 'FIXED_DAYS', fixedMonthDays: 30, quota: 6, expireUnused: false },
          { unit: 'WEEK', length: 1, quota: 3, expireUnused: false },
        ],
        reminderDaysBefore: 0,
      };
      const res = await as(ownerToken).patch(`/catalog/package-definitions/${definitionId}/usage-rule`).send({ usageRule: edited });
      expect(res.status).toBe(200);

      const sold = await prisma.memberPackage.findUniqueOrThrow({ where: { id: packageId } });
      expect((sold.usageRule as { tiers: unknown[] }).tiers).toEqual(RULE.tiers);

      const renewed = await sell();
      const fresh = await prisma.memberPackage.findUniqueOrThrow({ where: { id: renewed } });
      expect((fresh.usageRule as { tiers: unknown[] }).tiers).toEqual(edited.tiers);
    });

    it('clears a rule with null and sells later packages without a snapshot', async () => {
      const res = await as(ownerToken).patch(`/catalog/package-definitions/${definitionId}/usage-rule`).send({ usageRule: null });
      expect(res.status).toBe(200);
      expect(res.body.usageRule).toBeNull();
      const plain = await sell();
      expect((await prisma.memberPackage.findUniqueOrThrow({ where: { id: plain } })).usageRule).toBeNull();
    });
  });

  describe('daily burn job (real database)', () => {
    it('burns the unused quota of an ended period once, under the unique key and the row lock', async () => {
      await setSwitch(true);
      const day = 24 * HOUR;
      const pkg = await prisma.memberPackage.create({
        data: {
          studioId: ZEN,
          memberId,
          packageDefinitionId: definitionId,
          entitlementKind: 'SESSION_COUNT',
          totalUnits: 8,
          usedUnits: 1,
          remainingUnits: 7,
          status: 'ACTIVE',
          startDate: new Date(Date.now() - 45 * day),
          endDate: new Date(Date.now() + 45 * day),
          usageRule: { version: 1, tiers: [{ unit: 'MONTH', length: 1, monthMode: 'CALENDAR', quota: 3, expireUnused: true }], reminderDaysBefore: 0 },
        },
      });
      packageIds.push(pkg.id);
      const start = new Date(Date.now() - 40 * day);
      const past = await prisma.sessionSchedule.create({
        data: { studioId: ZEN, serviceTypeId, title: 'E2E gecmis', startTime: start, endTime: new Date(start.getTime() + HOUR), capacity: 3 },
      });
      scheduleIds.push(past.id);
      await prisma.booking.create({ data: { studioId: ZEN, scheduleId: past.id, memberId, memberPackageId: pkg.id, status: 'ATTENDED', unitsCharged: 1 } });

      const jobs = app.get(UsagePeriodsJobsService);
      const ctx = { enabled: true, timeZone: 'Europe/Istanbul' };
      const first = await jobs.burnPackage(pkg.id, ZEN, ctx, new Date());
      expect(first).toEqual({ periodsRecorded: 1, unitsBurned: 2, depleted: false });
      const second = await jobs.burnPackage(pkg.id, ZEN, ctx, new Date());
      expect(second).toEqual({ periodsRecorded: 0, unitsBurned: 0, depleted: false });

      const row = await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkg.id } });
      expect(row.remainingUnits).toBe(5);
      expect(row.status).toBe('ACTIVE');
      const history = await prisma.packageUnitExpiry.findMany({ where: { memberPackageId: pkg.id } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ tierUnit: 'MONTH', units: 2 });

      const listed = await as(ownerToken).get(`/members/packages/${pkg.id}/unit-expiries`);
      expect(listed.status).toBe(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0]).toMatchObject({ tierUnit: 'MONTH', units: 2 });
    });
  });
});
