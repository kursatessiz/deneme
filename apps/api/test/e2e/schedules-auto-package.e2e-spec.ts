import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * A booking without memberPackageId is charged to the member's usable package
 * that expires soonest; with no usable package it is refused, unless staff opt
 * out with chargePackage:false (audited). The suite owns its service type,
 * policy and package definitions.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe('Schedules: automatic package selection (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let ownerToken: string;
  let memberToken: string;

  let serviceTypeId: string;
  let policyId: string;
  let sessionDefId: string;
  let creditDefId: string;
  let selfMemberId: string;
  let members: string[];

  const scheduleIds: string[] = [];
  const packageIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  const as = (token: string) => ({
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
  });

  const makeSchedule = async () => {
    const start = new Date(Date.now() + 72 * HOUR);
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        serviceTypeId,
        title: 'E2E otomatik paket',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity: 3,
      },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  const makePackage = async (
    memberId: string,
    over: { kind?: 'SESSION_COUNT' | 'CREDIT'; units?: number; expiresInDays?: number; status?: 'ACTIVE' | 'FROZEN' } = {},
  ) => {
    const kind = over.kind ?? 'SESSION_COUNT';
    const units = over.units ?? 5;
    const p = await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId,
        packageDefinitionId: kind === 'CREDIT' ? creditDefId : sessionDefId,
        entitlementKind: kind,
        totalUnits: units,
        remainingUnits: units,
        status: over.status ?? 'ACTIVE',
        endDate: new Date(Date.now() + (over.expiresInDays ?? 30) * DAY),
      },
    });
    packageIds.push(p.id);
    return p.id;
  };

  const remaining = async (packageId: string) =>
    (await prisma.memberPackage.findUniqueOrThrow({ where: { id: packageId } })).remainingUnits;

  const bookAsOwner = (memberId: string, scheduleId: string, extra: Record<string, unknown> = {}) =>
    as(ownerToken).post('/schedules/book').send({ studioId: ZEN, scheduleId, memberId, ...extra });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    ownerToken = await login('+905321000002');
    memberToken = await login('+905321000016');

    const suffix = Date.now().toString(36);
    const policy = await prisma.cancellationPolicy.create({
      data: { studioId: ZEN, name: `E2E auto ${suffix}`, freeCancelHours: 12, lateCancelChargeUnits: 1, noShowChargeUnits: 1 },
    });
    policyId = policy.id;
    const serviceType = await prisma.serviceType.create({
      data: {
        studioId: ZEN,
        name: `E2E auto hizmet ${suffix}`,
        durationMin: 60,
        capacity: 3,
        cancellationPolicyId: policyId,
        allowedEntitlementKinds: ['SESSION_COUNT', 'CREDIT'],
      },
    });
    serviceTypeId = serviceType.id;
    sessionDefId = (
      await prisma.packageDefinition.create({
        data: {
          studioId: ZEN,
          name: `E2E seans ${suffix}`,
          entitlementKind: 'SESSION_COUNT',
          totalUnits: 5,
          validityDays: 30,
          price: 0,
          services: { create: { serviceTypeId, unitCost: 1 } },
        },
      })
    ).id;
    creditDefId = (
      await prisma.packageDefinition.create({
        data: {
          studioId: ZEN,
          name: `E2E kredi ${suffix}`,
          entitlementKind: 'CREDIT',
          totalUnits: 10,
          validityDays: 30,
          price: 0,
          services: { create: { serviceTypeId, unitCost: 3 } },
        },
      })
    ).id;

    selfMemberId = (
      await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: '+905321000016' } } } })
    ).id;
    members = (
      await prisma.memberProfile.findMany({ where: { studioId: ZEN, id: { not: selfMemberId } }, take: 5, orderBy: { id: 'asc' } })
    ).map((m) => m.id);
    expect(members).toHaveLength(5);
  });

  afterAll(async () => {
    await prisma.bookingResource.deleteMany({ where: { booking: { scheduleId: { in: scheduleIds } } } });
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: scheduleIds } }, { action: 'booking.no_charge', metadata: { path: ['serviceTypeId'], equals: serviceTypeId } }] } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.packageDefinition.deleteMany({ where: { id: { in: [sessionDefId, creditDefId] } } });
    await prisma.serviceType.deleteMany({ where: { id: serviceTypeId } });
    await prisma.cancellationPolicy.deleteMany({ where: { id: policyId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('staff booking without memberPackageId consumes a unit from the soonest-expiring usable package', async () => {
    const later = await makePackage(members[0], { units: 5, expiresInDays: 60 });
    const sooner = await makePackage(members[0], { units: 5, expiresInDays: 10 });
    const schedule = await makeSchedule();

    const res = await bookAsOwner(members[0], schedule);
    expect(res.status).toBe(201);
    expect(res.body.memberPackageId).toBe(sooner);
    expect(res.body.chargedPackage).toMatchObject({ memberPackageId: sooner, unitsCharged: 1, remainingUnits: 4 });
    expect(await remaining(sooner)).toBe(4);
    expect(await remaining(later)).toBe(5);
  });

  it('skips frozen and exhausted packages when choosing', async () => {
    await makePackage(members[1], { units: 5, expiresInDays: 5, status: 'FROZEN' });
    await makePackage(members[1], { units: 0, expiresInDays: 6 });
    const usable = await makePackage(members[1], { units: 2, expiresInDays: 40 });
    const res = await bookAsOwner(members[1], await makeSchedule());
    expect(res.status).toBe(201);
    expect(res.body.memberPackageId).toBe(usable);
    expect(await remaining(usable)).toBe(1);
  });

  it('a CREDIT_BASED package is charged the service credit cost', async () => {
    const credit = await makePackage(members[2], { kind: 'CREDIT', units: 10 });
    const res = await bookAsOwner(members[2], await makeSchedule());
    expect(res.status).toBe(201);
    expect(res.body.memberPackageId).toBe(credit);
    expect(res.body.unitsCharged).toBe(3);
    expect(await remaining(credit)).toBe(7);
  });

  it('cancelling refunds the unit to the package that was charged automatically', async () => {
    const pkg = await makePackage(members[3], { units: 3 });
    const res = await bookAsOwner(members[3], await makeSchedule());
    expect(res.status).toBe(201);
    expect(await remaining(pkg)).toBe(2);
    const cancel = await as(ownerToken).post('/schedules/cancel').send({ studioId: ZEN, bookingId: res.body.id, cancelledBy: 'STUDIO' });
    expect(cancel.status).toBe(201);
    expect(await remaining(pkg)).toBe(3);
  });

  it('answers 400 apiErrors.schedules.noUsablePackage when the member has no usable package', async () => {
    const res = await bookAsOwner(members[4], await makeSchedule());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('apiErrors.schedules.noUsablePackage');
  });

  it('a member booking for themselves is charged automatically too, and refused without a package', async () => {
    const schedule = await makeSchedule();
    const refused = await as(memberToken).post('/schedules/book/self').send({ studioId: ZEN, scheduleId: schedule, memberId: selfMemberId });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('apiErrors.schedules.noUsablePackage');

    const pkg = await makePackage(selfMemberId, { units: 2 });
    const ok = await as(memberToken).post('/schedules/book/self').send({ studioId: ZEN, scheduleId: schedule, memberId: selfMemberId });
    expect(ok.status).toBe(201);
    expect(ok.body.chargedPackage.memberPackageId).toBe(pkg);
    expect(await remaining(pkg)).toBe(1);
  });

  it('staff chargePackage:false books without deduction and writes an audit row', async () => {
    const pkg = await makePackage(members[4], { units: 4 });
    const res = await bookAsOwner(members[4], await makeSchedule(), { chargePackage: false });
    expect(res.status).toBe(201);
    expect(res.body.memberPackageId).toBeNull();
    expect(res.body.unitsCharged).toBe(0);
    expect(res.body.chargedPackage).toBeNull();
    expect(await remaining(pkg)).toBe(4);
    const audit = await prisma.auditLog.findFirst({ where: { studioId: ZEN, action: 'booking.no_charge', entityId: res.body.id } });
    expect(audit).not.toBeNull();
  });

  it('a member sending chargePackage:false gets 403 and no booking is made', async () => {
    const schedule = await makeSchedule();
    const res = await as(memberToken)
      .post('/schedules/book/self')
      .send({ studioId: ZEN, scheduleId: schedule, memberId: selfMemberId, chargePackage: false });
    expect(res.status).toBe(403);
    expect(await prisma.booking.count({ where: { scheduleId: schedule } })).toBe(0);
  });
});
