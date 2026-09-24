import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * Backlog W5: the spot map for a session's member-selectable resources
 * (equipment inside a room, or standalone resources at the session's
 * branch), and changing the spot held by an existing booking. Builds its
 * own service type against the seed's EMS device and reformer resource
 * types so it never depends on (or alters) seed bookings, and removes
 * everything it created afterwards.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;

describe('Schedules: spot map (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let emsResourceTypeId: string;
  let emsDevice1: string;
  let emsDevice2: string;
  let emsBranchId: string;
  let reformerResourceTypeId: string;
  let salonId: string;

  let emsServiceTypeId: string;
  let emsPackageDefinitionId: string;
  let reformerServiceTypeId: string;
  let reformerPackageDefinitionId: string;

  let selfMemberId: string;
  let otherMemberId: string;

  const scheduleIds: string[] = [];
  const packageIds: string[] = [];
  const bookingIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  const as = (token: string, studioId = ZEN) => ({
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const makeEmsSchedule = async (startInHours: number, capacity = 3) => {
    const start = new Date(Date.now() + startInHours * HOUR);
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId: emsBranchId,
        serviceTypeId: emsServiceTypeId,
        title: 'E2E EMS spot',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity,
      },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  const makePackage = async (memberId: string, packageDefinitionId: string, units: number) => {
    const p = await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId,
        packageDefinitionId,
        entitlementKind: 'SESSION_COUNT',
        totalUnits: units,
        remainingUnits: units,
        endDate: new Date(Date.now() + 30 * 24 * HOUR),
      },
    });
    packageIds.push(p.id);
    return p.id;
  };

  const bookSelf = (memberId: string, scheduleId: string, memberPackageId: string, resourceIds: string[]) =>
    as(memberToken)
      .post('/schedules/book/self')
      .send({ studioId: ZEN, scheduleId, memberId, memberPackageId, resourceIds });

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

    const emsType = await prisma.resourceType.findFirstOrThrow({ where: { studioId: ZEN, name: 'EMS Cihazi' } });
    emsResourceTypeId = emsType.id;
    const emsDevices = await prisma.resource.findMany({
      where: { studioId: ZEN, resourceTypeId: emsResourceTypeId },
      orderBy: { label: 'asc' },
    });
    expect(emsDevices.length).toBeGreaterThanOrEqual(2);
    emsDevice1 = emsDevices[0].id;
    emsDevice2 = emsDevices[1].id;
    emsBranchId = emsDevices[0].branchId!;

    const reformerType = await prisma.resourceType.findFirstOrThrow({ where: { studioId: ZEN, name: 'Reformer' } });
    reformerResourceTypeId = reformerType.id;
    const salon = await prisma.resource.findFirstOrThrow({
      where: { studioId: ZEN, name: 'Ana Salon', branchId: emsBranchId },
    });
    salonId = salon.id;

    const suffix = Date.now().toString(36);

    const emsServiceType = await prisma.serviceType.create({
      data: { studioId: ZEN, name: `E2E EMS spot ${suffix}`, durationMin: 20, capacity: 3 },
    });
    emsServiceTypeId = emsServiceType.id;
    await prisma.serviceTypeResourceType.create({
      data: { serviceTypeId: emsServiceTypeId, resourceTypeId: emsResourceTypeId, quantity: 1 },
    });
    const emsPackageDef = await prisma.packageDefinition.create({
      data: {
        studioId: ZEN,
        name: `E2E EMS paket ${suffix}`,
        entitlementKind: 'SESSION_COUNT',
        totalUnits: 10,
        validityDays: 30,
        price: 0,
        services: { create: { serviceTypeId: emsServiceTypeId, unitCost: 1 } },
      },
    });
    emsPackageDefinitionId = emsPackageDef.id;

    const reformerServiceType = await prisma.serviceType.create({
      data: { studioId: ZEN, name: `E2E reformer spot ${suffix}`, durationMin: 50, capacity: 6 },
    });
    reformerServiceTypeId = reformerServiceType.id;
    await prisma.serviceTypeResourceType.create({
      data: { serviceTypeId: reformerServiceTypeId, resourceTypeId: reformerResourceTypeId, quantity: 1 },
    });
    const reformerPackageDef = await prisma.packageDefinition.create({
      data: {
        studioId: ZEN,
        name: `E2E reformer paket ${suffix}`,
        entitlementKind: 'SESSION_COUNT',
        totalUnits: 10,
        validityDays: 30,
        price: 0,
        services: { create: { serviceTypeId: reformerServiceTypeId, unitCost: 1 } },
      },
    });
    reformerPackageDefinitionId = reformerPackageDef.id;

    const self = await prisma.memberProfile.findFirstOrThrow({
      where: { studioId: ZEN, membership: { user: { phone: '+905321000016' } } },
    });
    selfMemberId = self.id;
    const other = await prisma.memberProfile.findFirstOrThrow({
      where: { studioId: ZEN, id: { not: selfMemberId } },
    });
    otherMemberId = other.id;
  });

  afterAll(async () => {
    await prisma.bookingResource.deleteMany({ where: { booking: { scheduleId: { in: scheduleIds } } } });
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.packageDefinition.deleteMany({ where: { id: { in: [emsPackageDefinitionId, reformerPackageDefinitionId] } } });
    await prisma.serviceType.deleteMany({ where: { id: { in: [emsServiceTypeId, reformerServiceTypeId] } } });
    await prisma.resource.updateMany({ where: { id: { in: [emsDevice1, emsDevice2] } }, data: { isMaintenance: false } });
    void bookingIds;
    await prisma.$disconnect();
    await app.close();
  });

  describe('branch-level spot map (EMS devices, no room)', () => {
    let scheduleId: string;

    beforeAll(async () => {
      scheduleId = await makeEmsSchedule(60);
    });

    it('a service requiring a selectable spot rejects a booking with no spot chosen', async () => {
      const pkg = await makePackage(selfMemberId, emsPackageDefinitionId, 5);
      const res = await bookSelf(selfMemberId, scheduleId, pkg, []);
      expect(res.status).toBe(400);
    });

    it('starts with every device available to a member, grouped by resource type', async () => {
      const res = await as(memberToken).get(`/schedules/${scheduleId}/spots`);
      expect(res.status).toBe(200);
      expect(res.body.roomResourceId).toBeNull();
      const group = res.body.groups.find((g: any) => g.resourceTypeId === emsResourceTypeId);
      expect(group).toBeDefined();
      const device1 = group.spots.find((s: any) => s.id === emsDevice1);
      expect(device1.status).toBe('AVAILABLE');
      expect(device1.label).toBe('1');
    });

    it('booking a device makes it TAKEN for other members without revealing who holds it', async () => {
      const otherPkg = await makePackage(otherMemberId, emsPackageDefinitionId, 5);
      const booked = await as(ownerToken)
        .post('/schedules/book')
        .send({ studioId: ZEN, scheduleId, memberId: otherMemberId, memberPackageId: otherPkg, resourceIds: [emsDevice1] });
      expect(booked.status).toBe(201);
      bookingIds.push(booked.body.id);

      const memberView = await as(memberToken).get(`/schedules/${scheduleId}/spots`);
      const memberDevice1 = memberView.body.groups
        .find((g: any) => g.resourceTypeId === emsResourceTypeId)
        .spots.find((s: any) => s.id === emsDevice1);
      expect(memberDevice1.status).toBe('TAKEN');
      expect(memberDevice1.takenByMemberName).toBeFalsy();

      const trainerView = await as(trainerToken).get(`/schedules/${scheduleId}/spots`);
      const trainerDevice1 = trainerView.body.groups
        .find((g: any) => g.resourceTypeId === emsResourceTypeId)
        .spots.find((s: any) => s.id === emsDevice1);
      expect(trainerDevice1.status).toBe('TAKEN');
      expect(typeof trainerDevice1.takenByMemberName).toBe('string');
      expect(trainerDevice1.takenByMemberName.length).toBeGreaterThan(0);
    });

    it('a second member booking the same device gets 409', async () => {
      const pkg = await makePackage(selfMemberId, emsPackageDefinitionId, 5);
      const res = await bookSelf(selfMemberId, scheduleId, pkg, [emsDevice1]);
      expect(res.status).toBe(409);
    });

    it('the holder sees their own spot as MINE, the other member sees it as AVAILABLE elsewhere', async () => {
      const selfPkg = await makePackage(selfMemberId, emsPackageDefinitionId, 5);
      const selfBooked = await bookSelf(selfMemberId, scheduleId, selfPkg, [emsDevice2]);
      expect(selfBooked.status).toBe(201);
      bookingIds.push(selfBooked.body.id);

      const view = await as(memberToken).get(`/schedules/${scheduleId}/spots`);
      const group = view.body.groups.find((g: any) => g.resourceTypeId === emsResourceTypeId);
      expect(group.spots.find((s: any) => s.id === emsDevice2).status).toBe('MINE');
      // Device 1, held by someone else, still hides the identity from a member.
      expect(group.spots.find((s: any) => s.id === emsDevice1).takenByMemberName).toBeFalsy();
    });

    it('a maintenance device shows MAINTENANCE even while held', async () => {
      await prisma.resource.update({ where: { id: emsDevice2 }, data: { isMaintenance: true } });
      const res = await as(memberToken).get(`/schedules/${scheduleId}/spots`);
      const device2 = res.body.groups
        .find((g: any) => g.resourceTypeId === emsResourceTypeId)
        .spots.find((s: any) => s.id === emsDevice2);
      expect(device2.status).toBe('MAINTENANCE');
      await prisma.resource.update({ where: { id: emsDevice2 }, data: { isMaintenance: false } });
    });
  });

  describe('self packages, filtered by service coverage', () => {
    it('lists only active packages covering the given service', async () => {
      const pkg = await makePackage(selfMemberId, emsPackageDefinitionId, 4);
      const matching = await as(memberToken).get(`/members/self/packages?serviceTypeId=${emsServiceTypeId}`);
      expect(matching.status).toBe(200);
      expect(matching.body.some((p: any) => p.id === pkg)).toBe(true);

      const unrelated = await as(memberToken).get(`/members/self/packages?serviceTypeId=${reformerServiceTypeId}`);
      expect(unrelated.body.some((p: any) => p.id === pkg)).toBe(false);
    });
  });

  describe('changing the spot of an existing booking', () => {
    let scheduleId: string;
    let bookingId: string;

    beforeAll(async () => {
      scheduleId = await makeEmsSchedule(72);
      const pkg = await makePackage(selfMemberId, emsPackageDefinitionId, 5);
      const res = await bookSelf(selfMemberId, scheduleId, pkg, [emsDevice1]);
      expect(res.status).toBe(201);
      bookingId = res.body.id;
      bookingIds.push(bookingId);
    });

    it('a member moves their own booking to a free device', async () => {
      const res = await as(memberToken).post(`/schedules/bookings/${bookingId}/spot/self`).send({ resourceIds: [emsDevice2] });
      expect(res.status).toBe(201);

      const rows = await prisma.bookingResource.findMany({ where: { bookingId, isActive: true } });
      expect(rows.map((r) => r.resourceId)).toEqual([emsDevice2]);

      const spots = await as(memberToken).get(`/schedules/${scheduleId}/spots`);
      const group = spots.body.groups.find((g: any) => g.resourceTypeId === emsResourceTypeId);
      expect(group.spots.find((s: any) => s.id === emsDevice2).status).toBe('MINE');
      expect(group.spots.find((s: any) => s.id === emsDevice1).status).toBe('AVAILABLE');
    });

    it('a taken device rejects the change with 409 and leaves the old spot intact', async () => {
      const otherPkg = await makePackage(otherMemberId, emsPackageDefinitionId, 5);
      const otherBooked = await as(ownerToken)
        .post('/schedules/book')
        .send({ studioId: ZEN, scheduleId, memberId: otherMemberId, memberPackageId: otherPkg, resourceIds: [emsDevice1] });
      expect(otherBooked.status).toBe(201);
      bookingIds.push(otherBooked.body.id);

      const res = await as(memberToken).post(`/schedules/bookings/${bookingId}/spot/self`).send({ resourceIds: [emsDevice1] });
      expect(res.status).toBe(409);

      const rows = await prisma.bookingResource.findMany({ where: { bookingId, isActive: true } });
      expect(rows.map((r) => r.resourceId)).toEqual([emsDevice2]);
    });

    it('a caller unrelated to this booking cannot change its spot from another tenant', async () => {
      const res = await as(ownerToken, FLOW)
        .post(`/schedules/bookings/${bookingId}/spot`)
        .send({ resourceIds: [emsDevice2] });
      // Not a member of FLOW at all, so the tenant guard rejects before the booking is even looked up.
      expect(res.status).toBe(403);
    });
  });

  describe('room-level spot map (reformers under a room)', () => {
    let scheduleId: string;

    it('groups by the session room, not the branch', async () => {
      const start = new Date(Date.now() + 90 * HOUR);
      const s = await prisma.sessionSchedule.create({
        data: {
          studioId: ZEN,
          branchId: emsBranchId,
          resourceId: salonId,
          serviceTypeId: reformerServiceTypeId,
          title: 'E2E reformer spot',
          startTime: start,
          endTime: new Date(start.getTime() + HOUR),
          capacity: 6,
        },
      });
      scheduleIds.push(s.id);
      scheduleId = s.id;

      const res = await as(memberToken).get(`/schedules/${scheduleId}/spots`);
      expect(res.status).toBe(200);
      expect(res.body.roomResourceId).toBe(salonId);
      const group = res.body.groups.find((g: any) => g.resourceTypeId === reformerResourceTypeId);
      expect(group).toBeDefined();
      expect(group.spots.length).toBeGreaterThanOrEqual(6);
      expect(group.spots.every((s: any) => s.status === 'AVAILABLE')).toBe(true);
      // EMS devices are not under this room, so they must not appear here.
      expect(res.body.groups.some((g: any) => g.resourceTypeId === emsResourceTypeId)).toBe(false);
    });
  });

  describe('cross-tenant access', () => {
    it('a schedule id from another tenant is not found under this studio', async () => {
      const flowSchedule = await prisma.sessionSchedule.findFirst({ where: { studioId: FLOW } });
      expect(flowSchedule).not.toBeNull();
      const res = await as(ownerToken, ZEN).get(`/schedules/${flowSchedule!.id}/spots`);
      expect(res.status).toBe(404);
    });

    it('acting on a studio the caller does not belong to -> 403', async () => {
      const res = await as(ownerToken, FLOW).get(`/schedules/00000000-0000-0000-0000-000000000000/spots`);
      expect(res.status).toBe(403);
    });
  });
});
