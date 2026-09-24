import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W10: automated marketing and lifecycle flows. CRUD, permissions, dry-run
 * audience preview, at-most-once delivery (idempotency), and İYS consent
 * gating (marketing vs transactional). Builds its own service type, package
 * and schedule so it never depends on the seed's catalogue, and removes
 * everything it created afterwards.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3_600_000;

// A fixed "now" for the scheduler runs below, always at 12:00 Europe/Istanbul
// (outside quiet hours) regardless of the real wall-clock time when the
// suite runs. Bookings are scheduled relative to this same instant.
const SCHED_NOW = new Date(Date.now());
SCHED_NOW.setUTCHours(9, 0, 0, 0); // 12:00 Istanbul (UTC+3)

describe('Automations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;
  let superAdminToken: string;

  let serviceTypeId: string;
  let packageDefinitionId: string;
  let memberUserId: string; // +905321000016
  let memberProfileId: string;
  let winBackMemberId: string;
  let winBackUserId: string;

  const ruleIds: string[] = [];
  const scheduleIds: string[] = [];
  const packageIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const runScheduler = () =>
    request(server)
      .post('/admin/scheduler/run')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ now: SCHED_NOW.toISOString() });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;

    ownerToken = await login('+905321000002');
    trainerToken = await login('+905321000004');
    memberToken = await login('+905321000016');
    superAdminToken = await login('+905321000001');

    const suffix = Date.now().toString(36);
    const serviceType = await prisma.serviceType.create({
      data: { studioId: ZEN, name: `Otomasyon hizmet ${suffix}`, durationMin: 60, capacity: 4 },
    });
    serviceTypeId = serviceType.id;
    const def = await prisma.packageDefinition.create({
      data: {
        studioId: ZEN,
        name: `Otomasyon kredi ${suffix}`,
        entitlementKind: 'CREDIT',
        totalUnits: 10,
        validityDays: 30,
        price: 0,
        services: { create: { serviceTypeId, unitCost: 1 } },
      },
    });
    packageDefinitionId = def.id;

    const memberUser = await prisma.user.findUniqueOrThrow({ where: { phone: '+905321000016' } });
    memberUserId = memberUser.id;
    const memberProfile = await prisma.memberProfile.findFirstOrThrow({
      where: { studioId: ZEN, membership: { userId: memberUserId } },
    });
    memberProfileId = memberProfile.id;

    // BOOKING_REMINDER defaults to sms: false (push only); turn SMS on so
    // the automation runner's send() actually reaches a channel below.
    await prisma.notificationPreference.upsert({
      where: { userId_category: { userId: memberUserId, category: 'BOOKING_REMINDER' } },
      create: { userId: memberUserId, category: 'BOOKING_REMINDER', push: true, sms: true },
      update: { sms: true },
    });

    // A dedicated member with no bookings, no packages and no consent on
    // record: a deterministic WIN_BACK candidate, independent of seed data.
    const memberRole = await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'member' } });
    const winBackPhone = `+90532${String(Date.now() % 10_000_000).padStart(7, '0')}`;
    const winBackUser = await prisma.user.create({
      data: { phone: winBackPhone, firstName: 'Otomasyon', lastName: `Test${suffix}` },
    });
    winBackUserId = winBackUser.id;
    const winBackMembership = await prisma.membership.create({
      data: { userId: winBackUserId, studioId: ZEN, roleTemplateId: memberRole.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    const winBackProfile = await prisma.memberProfile.create({
      data: { membershipId: winBackMembership.id, studioId: ZEN },
    });
    winBackMemberId = winBackProfile.id;
  });

  afterAll(async () => {
    await prisma.automationRun.deleteMany({ where: { ruleId: { in: ruleIds } } });
    await prisma.automationRule.deleteMany({ where: { id: { in: ruleIds } } });
    await prisma.notificationLog.deleteMany({ where: { studioId: ZEN, type: { in: ['BOOKING_REMINDER', 'WIN_BACK'] } } });
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.packageDefinition.deleteMany({ where: { id: packageDefinitionId } });
    await prisma.serviceType.deleteMany({ where: { id: serviceTypeId } });
    await prisma.notificationPreference.deleteMany({ where: { userId: winBackUserId } });
    await prisma.communicationConsent.deleteMany({ where: { studioId: ZEN, userId: winBackUserId } });
    await prisma.memberProfile.deleteMany({ where: { id: winBackMemberId } });
    await prisma.membership.deleteMany({ where: { userId: winBackUserId, studioId: ZEN } });
    await prisma.user.deleteMany({ where: { id: winBackUserId } });
    await prisma.notificationPreference.deleteMany({ where: { userId: memberUserId, category: 'BOOKING_REMINDER' } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('CRUD and validation', () => {
    it('owner creates, reads, updates and toggles a rule', async () => {
      const create = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'PACKAGE_EXPIRING',
        name: 'E2E paket bitişi',
        templateKey: 'PACKAGE_EXPIRING',
        params: { type: 'PACKAGE_EXPIRING', daysBefore: 5 },
        isActive: false,
      });
      expect(create.status).toBe(201);
      expect(create.body.isTransactional).toBe(true);
      ruleIds.push(create.body.id);

      const list = await as(ownerToken, ZEN).get(`/studios/${ZEN}/automation-rules`);
      expect(list.status).toBe(200);
      expect(list.body.items.some((r: any) => r.id === create.body.id)).toBe(true);

      const get = await as(ownerToken, ZEN).get(`/studios/${ZEN}/automation-rules/${create.body.id}`);
      expect(get.status).toBe(200);
      expect(get.body.name).toBe('E2E paket bitişi');

      const update = await as(ownerToken, ZEN)
        .put(`/studios/${ZEN}/automation-rules/${create.body.id}`)
        .send({ params: { type: 'PACKAGE_EXPIRING', daysBefore: 10 } });
      expect(update.status).toBe(200);
      expect(update.body.params.daysBefore).toBe(10);

      const toggle = await as(ownerToken, ZEN)
        .patch(`/studios/${ZEN}/automation-rules/${create.body.id}/toggle`)
        .send({ isActive: true });
      expect(toggle.status).toBe(200);
      expect(toggle.body.isActive).toBe(true);
    });

    it('derives isTransactional from type: WIN_BACK is marketing', async () => {
      const create = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'WIN_BACK',
        name: 'E2E kayıp üye',
        templateKey: 'WIN_BACK',
        params: { type: 'WIN_BACK', noAttendanceDays: 30 },
      });
      expect(create.status).toBe(201);
      expect(create.body.isTransactional).toBe(false);
      ruleIds.push(create.body.id);
    });

    it('rejects a PACKAGE_EXPIRING rule with neither threshold set', async () => {
      const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'PACKAGE_EXPIRING',
        name: 'Geçersiz',
        templateKey: 'PACKAGE_EXPIRING',
        params: { type: 'PACKAGE_EXPIRING' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects a type/params.type mismatch', async () => {
      const res = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'BIRTHDAY',
        name: 'Geçersiz',
        templateKey: 'BIRTHDAY',
        params: { type: 'WIN_BACK', noAttendanceDays: 10 },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('permissions', () => {
    it('trainer and member cannot manage automation rules', async () => {
      for (const token of [trainerToken, memberToken]) {
        expect((await as(token, ZEN).get(`/studios/${ZEN}/automation-rules`)).status).toBe(403);
        expect(
          (
            await as(token, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
              type: 'BIRTHDAY',
              name: 'x',
              templateKey: 'BIRTHDAY',
              params: { type: 'BIRTHDAY' },
            })
          ).status,
        ).toBe(403);
      }
    });

    it('a Zen owner has no membership at Flow, so the whole route is forbidden', async () => {
      expect((await as(ownerToken, FLOW).get(`/studios/${FLOW}/automation-rules`)).status).toBe(403);
    });

    it('a non-super-admin cannot trigger the scheduler', async () => {
      const res = await request(server).post('/admin/scheduler/run').set('Authorization', `Bearer ${ownerToken}`).send({});
      expect(res.status).toBe(403);
    });
  });

  describe('dry-run audience preview', () => {
    it('returns a candidate count without creating runs or sending anything', async () => {
      const create = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'WIN_BACK',
        name: 'E2E önizleme',
        templateKey: 'WIN_BACK',
        params: { type: 'WIN_BACK', noAttendanceDays: 1 },
      });
      expect(create.status).toBe(201);
      ruleIds.push(create.body.id);

      const preview = await as(ownerToken, ZEN).get(`/studios/${ZEN}/automation-rules/${create.body.id}/preview`);
      expect(preview.status).toBe(200);
      expect(typeof preview.body.count).toBe('number');

      const runs = await prisma.automationRun.count({ where: { ruleId: create.body.id } });
      expect(runs).toBe(0);
    });
  });

  describe('running the scheduled evaluator', () => {
    it('a booking reminder is sent exactly once across two runs (idempotency)', async () => {
      const start = new Date(SCHED_NOW.getTime() + 1 * HOUR);
      const schedule = await prisma.sessionSchedule.create({
        data: {
          studioId: ZEN,
          serviceTypeId,
          title: 'Otomasyon hatırlatma dersi',
          startTime: start,
          endTime: new Date(start.getTime() + HOUR),
          capacity: 4,
        },
      });
      scheduleIds.push(schedule.id);
      const pkg = await prisma.memberPackage.create({
        data: {
          studioId: ZEN,
          memberId: memberProfileId,
          packageDefinitionId,
          entitlementKind: 'CREDIT',
          totalUnits: 10,
          remainingUnits: 10,
          endDate: new Date(SCHED_NOW.getTime() + 30 * 24 * HOUR),
        },
      });
      packageIds.push(pkg.id);
      const bookRes = await as(ownerToken, ZEN)
        .post('/schedules/book')
        .send({ studioId: ZEN, scheduleId: schedule.id, memberId: memberProfileId, memberPackageId: pkg.id });
      expect(bookRes.status).toBe(201);
      const bookingId = bookRes.body.id as string;

      const rule = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'BOOKING_REMINDER',
        name: 'E2E hatırlatma',
        templateKey: 'BOOKING_REMINDER',
        params: { type: 'BOOKING_REMINDER', hoursBefore: 2 },
        isActive: true,
      });
      expect(rule.status).toBe(201);
      ruleIds.push(rule.body.id);

      const first = await runScheduler();
      expect(first.status).toBe(201);
      const second = await runScheduler();
      expect(second.status).toBe(201);

      const runs = await prisma.automationRun.findMany({ where: { ruleId: rule.body.id, targetRef: bookingId } });
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('SENT');

      const logs = await prisma.notificationLog.findMany({
        where: { studioId: ZEN, type: 'BOOKING_REMINDER', recipientPhone: '+905321000016', status: 'SENT' },
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it('a marketing rule is skipped without commercial consent', async () => {
      // No consent row exists for this member/channel: defaults to REVOKED.
      await prisma.notificationPreference.upsert({
        where: { userId_category: { userId: winBackUserId, category: 'MARKETING' } },
        create: { userId: winBackUserId, category: 'MARKETING', push: false, sms: true },
        update: { sms: true },
      });

      const rule = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'WIN_BACK',
        name: 'E2E onaysız kayıp üye',
        templateKey: 'WIN_BACK',
        params: { type: 'WIN_BACK', noAttendanceDays: 1, requireNoActivePackage: true },
        isActive: true,
      });
      expect(rule.status).toBe(201);
      ruleIds.push(rule.body.id);

      await runScheduler();

      const runs = await prisma.automationRun.findMany({ where: { ruleId: rule.body.id, userId: winBackUserId } });
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('SKIPPED');
      expect(runs[0].reason).toMatch(/onay/i);
    });

    it('a transactional reminder still sends after marketing consent is revoked', async () => {
      // The member from the idempotency test above never granted MARKETING
      // consent either (no row was created for it), yet their booking
      // reminder above still sent: transactional templates bypass consent
      // entirely (CLAUDE.md rule 8; never gated for reminders).
      const consent = await prisma.communicationConsent.findMany({ where: { studioId: ZEN, userId: memberUserId } });
      // Seed grants SMS/WHATSAPP consent for this demo member; revoke both to
      // prove the reminder does not depend on it.
      await prisma.communicationConsent.updateMany({
        where: { studioId: ZEN, userId: memberUserId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });

      const start = new Date(SCHED_NOW.getTime() + 1 * HOUR);
      const schedule = await prisma.sessionSchedule.create({
        data: {
          studioId: ZEN,
          serviceTypeId,
          title: 'Otomasyon hatırlatma dersi 2',
          startTime: start,
          endTime: new Date(start.getTime() + HOUR),
          capacity: 4,
        },
      });
      scheduleIds.push(schedule.id);
      const pkg = await prisma.memberPackage.create({
        data: {
          studioId: ZEN,
          memberId: memberProfileId,
          packageDefinitionId,
          entitlementKind: 'CREDIT',
          totalUnits: 10,
          remainingUnits: 10,
          endDate: new Date(SCHED_NOW.getTime() + 30 * 24 * HOUR),
        },
      });
      packageIds.push(pkg.id);
      const bookRes = await as(ownerToken, ZEN)
        .post('/schedules/book')
        .send({ studioId: ZEN, scheduleId: schedule.id, memberId: memberProfileId, memberPackageId: pkg.id });
      expect(bookRes.status).toBe(201);
      const bookingId = bookRes.body.id as string;

      const rule = await as(ownerToken, ZEN).post(`/studios/${ZEN}/automation-rules`).send({
        type: 'BOOKING_REMINDER',
        name: 'E2E hatırlatma onaysız',
        templateKey: 'BOOKING_REMINDER',
        params: { type: 'BOOKING_REMINDER', hoursBefore: 2 },
        isActive: true,
      });
      expect(rule.status).toBe(201);
      ruleIds.push(rule.body.id);

      await runScheduler();

      const runs = await prisma.automationRun.findMany({ where: { ruleId: rule.body.id, targetRef: bookingId } });
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('SENT');

      // Restore consent for other suites that depend on it (see messaging.e2e-spec.ts).
      for (const c of consent) {
        await prisma.communicationConsent.update({ where: { id: c.id }, data: { status: c.status, revokedAt: c.revokedAt } });
      }
    });
  });

  describe('cross-tenant isolation', () => {
    it('Flow (scoped by a super admin) never sees Zen automation rules or runs', async () => {
      const list = await as(superAdminToken, FLOW).get(`/studios/${FLOW}/automation-rules`);
      expect(list.status).toBe(200);
      expect(list.body.items.every((r: any) => !ruleIds.includes(r.id))).toBe(true);

      const runs = await as(superAdminToken, FLOW).get(`/studios/${FLOW}/automation-rules/runs`);
      expect(runs.status).toBe(200);
      expect(runs.body.items.every((r: any) => r.studioId !== ZEN)).toBe(true);
    });

    it('a Zen-scoped rule id is not found when queried under Flow', async () => {
      const res = await as(superAdminToken, FLOW).get(`/studios/${FLOW}/automation-rules/${ruleIds[0]}`);
      expect(res.status).toBe(404);
    });
  });
});
