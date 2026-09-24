import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * E2E for the W1 catalog module (service types, resource types, resources,
 * cancellation policies) and the whole-session cancellation endpoint. Every
 * scenario creates and cleans up its own rows so the suite can run
 * repeatedly against the same seeded database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';

interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

describe('Catalog e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;

  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  const createdResourceTypeIds: string[] = [];
  const createdResourceIds: string[] = [];
  const createdPolicyIds: string[] = [];
  const createdServiceTypeIds: string[] = [];
  const createdScheduleIds: string[] = [];
  const createdBookingIds: string[] = [];
  const createdPackageIds: string[] = [];
  const createdWaitlistIds: string[] = [];

  const login = async (phone: string): Promise<LoginResult> => {
    const res = await request(server)
      .post('/auth/login')
      .send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body as LoginResult;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    server = app.getHttpServer();

    prisma = new PrismaClient();

    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    const flow = await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } });
    ZEN = zen.id;
    FLOW = flow.id;

    ownerToken = (await login('+905321000002')).accessToken;
    trainerToken = (await login('+905321000004')).accessToken;
    memberToken = (await login('+905321000016')).accessToken;
  });

  afterAll(async () => {
    if (createdWaitlistIds.length) {
      await prisma.waitlist.deleteMany({ where: { id: { in: createdWaitlistIds } } });
    }
    if (createdBookingIds.length) {
      await prisma.bookingResource.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    }
    if (createdScheduleIds.length) {
      await prisma.sessionSchedule.deleteMany({ where: { id: { in: createdScheduleIds } } });
    }
    if (createdPackageIds.length) {
      await prisma.memberPackage.deleteMany({ where: { id: { in: createdPackageIds } } });
    }
    if (createdServiceTypeIds.length) {
      await prisma.serviceTypeResourceType.deleteMany({ where: { serviceTypeId: { in: createdServiceTypeIds } } });
      await prisma.serviceType.deleteMany({ where: { id: { in: createdServiceTypeIds } } });
    }
    if (createdResourceIds.length) {
      await prisma.resource.deleteMany({ where: { id: { in: createdResourceIds } } });
    }
    if (createdResourceTypeIds.length) {
      await prisma.resourceType.deleteMany({ where: { id: { in: createdResourceTypeIds } } });
    }
    if (createdPolicyIds.length) {
      await prisma.cancellationPolicy.deleteMany({ where: { id: { in: createdPolicyIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('owner CRUD', () => {
    it('creates a resource type', async () => {
      const res = await request(server)
        .post('/catalog/resource-types')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, name: `E2E Kaynak Turu ${Date.now()}`, selectableByMember: true });
      expect(res.status).toBe(201);
      createdResourceTypeIds.push(res.body.id);
    });

    it('lists resource types', async () => {
      const res = await request(server)
        .get(`/catalog/resource-types/studio/${ZEN}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('updates a resource type', async () => {
      const id = createdResourceTypeIds[0];
      const res = await request(server)
        .patch(`/catalog/resource-types/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, selectableByMember: false });
      expect(res.status).toBe(200);
      expect(res.body.selectableByMember).toBe(false);
    });

    it('creates a resource under that resource type', async () => {
      const resourceTypeId = createdResourceTypeIds[0];
      const res = await request(server)
        .post('/catalog/resources')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, resourceTypeId, name: `E2E Kaynak ${Date.now()}`, capacity: 1 });
      expect(res.status).toBe(201);
      createdResourceIds.push(res.body.id);
    });

    it('toggles maintenance on a resource', async () => {
      const id = createdResourceIds[0];
      const res = await request(server)
        .patch(`/catalog/resources/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, isMaintenance: true });
      expect(res.status).toBe(200);
      expect(res.body.isMaintenance).toBe(true);
    });

    it('creates a cancellation policy', async () => {
      const res = await request(server)
        .post('/catalog/cancellation-policies')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, name: `E2E Politika ${Date.now()}`, freeCancelHours: 5 });
      expect(res.status).toBe(201);
      createdPolicyIds.push(res.body.id);
    });

    it('creates a service type referencing the new resource type and policy', async () => {
      const resourceTypeId = createdResourceTypeIds[0];
      const cancellationPolicyId = createdPolicyIds[0];
      const res = await request(server)
        .post('/catalog/service-types')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({
          studioId: ZEN,
          name: `E2E Hizmet ${Date.now()}`,
          durationMin: 50,
          capacity: 2,
          allowedEntitlementKinds: ['SESSION_COUNT'],
          cancellationPolicyId,
          requiresQualification: false,
          requiredResourceTypes: [{ resourceTypeId, quantity: 1 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.requiredResourceTypes).toHaveLength(1);
      createdServiceTypeIds.push(res.body.id);
    });

    it('deactivates the service type', async () => {
      const id = createdServiceTypeIds[0];
      const res = await request(server)
        .post(`/catalog/service-types/${id}/deactivate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN });
      expect(res.status).toBe(201);
      expect(res.body.isActive).toBe(false);
    });
  });

  describe('permission enforcement', () => {
    it('trainer gets 403 creating a resource type (no catalog.manage)', async () => {
      const res = await request(server)
        .post('/catalog/resource-types')
        .set('Authorization', `Bearer ${trainerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, name: 'Trainer Denemesi' });
      expect(res.status).toBe(403);
    });

    it('member gets 403 listing the catalog (no catalog.view)', async () => {
      const res = await request(server)
        .get(`/catalog/resource-types/studio/${ZEN}`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('cross-tenant id rejection', () => {
    let flowResourceTypeId: string;

    beforeAll(async () => {
      const rt = await prisma.resourceType.findFirstOrThrow({ where: { studioId: FLOW } });
      flowResourceTypeId = rt.id;
    });

    it('rejects creating a resource with a resource type from another studio', async () => {
      const res = await request(server)
        .post('/catalog/resources')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, resourceTypeId: flowResourceTypeId, name: 'Cross Tenant', capacity: 1 });
      expect([400, 404]).toContain(res.status);
    });

    it('rejects creating a service type requiring a resource type from another studio', async () => {
      const res = await request(server)
        .post('/catalog/service-types')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({
          studioId: ZEN,
          name: 'Cross Tenant Hizmet',
          durationMin: 30,
          capacity: 1,
          allowedEntitlementKinds: ['SESSION_COUNT'],
          requiresQualification: false,
          requiredResourceTypes: [{ resourceTypeId: flowResourceTypeId, quantity: 1 }],
        });
      expect(res.status).toBe(400);
    });
  });

  describe('single default cancellation policy invariant', () => {
    it('setting a new default clears the previous one for the same studio', async () => {
      const first = await request(server)
        .post('/catalog/cancellation-policies')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, name: `E2E Varsayilan A ${Date.now()}`, freeCancelHours: 4, isDefault: true });
      expect(first.status).toBe(201);
      createdPolicyIds.push(first.body.id);

      const second = await request(server)
        .post('/catalog/cancellation-policies')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, name: `E2E Varsayilan B ${Date.now()}`, freeCancelHours: 8, isDefault: true });
      expect(second.status).toBe(201);
      createdPolicyIds.push(second.body.id);

      const firstAfter = await prisma.cancellationPolicy.findUniqueOrThrow({ where: { id: first.body.id } });
      const secondAfter = await prisma.cancellationPolicy.findUniqueOrThrow({ where: { id: second.body.id } });
      expect(firstAfter.isDefault).toBe(false);
      expect(secondAfter.isDefault).toBe(true);
    });
  });

  describe('cancel-session', () => {
    let scheduleId: string;
    let memberId: string;
    let pkgId: string;
    let bookingId: string;

    beforeAll(async () => {
      const coverage = await prisma.packageDefinitionService.findFirst({
        where: { unitCost: 1, packageDefinition: { studioId: ZEN, isActive: true } },
      });
      if (!coverage) throw new Error('seed data missing a 1-unit-cost package/service coverage for Zen');

      const members = await prisma.memberProfile.findMany({ where: { studioId: ZEN }, take: 2 });
      if (members.length < 2) throw new Error('seed data missing at least two members for Zen');
      memberId = members[0].id;
      const waitlistMemberId = members[1].id;

      const now = Date.now();
      const schedule = await prisma.sessionSchedule.create({
        data: {
          studioId: ZEN,
          serviceTypeId: coverage.serviceTypeId,
          title: 'E2E Cancel Session',
          startTime: new Date(now + 60 * 3600_000),
          endTime: new Date(now + 61 * 3600_000),
          capacity: 1,
          bookedCount: 1,
        },
      });
      scheduleId = schedule.id;
      createdScheduleIds.push(scheduleId);

      const pkg = await prisma.memberPackage.create({
        data: {
          studioId: ZEN,
          memberId,
          packageDefinitionId: coverage.packageDefinitionId,
          entitlementKind: 'SESSION_COUNT',
          totalUnits: 1,
          usedUnits: 1,
          remainingUnits: 0,
          status: 'DEPLETED',
          startDate: new Date(now),
          endDate: new Date(now + 30 * 24 * 3600_000),
        },
      });
      pkgId = pkg.id;
      createdPackageIds.push(pkgId);

      const booking = await prisma.booking.create({
        data: {
          studioId: ZEN,
          scheduleId,
          memberId,
          memberPackageId: pkgId,
          status: 'CONFIRMED',
          unitsCharged: 1,
        },
      });
      bookingId = booking.id;
      createdBookingIds.push(bookingId);

      const waitlistEntry = await prisma.waitlist.create({
        data: { studioId: ZEN, scheduleId, memberId: waitlistMemberId, position: 1, status: 'WAITING' },
      });
      createdWaitlistIds.push(waitlistEntry.id);
    });

    it('trainer without schedule.manage gets 403', async () => {
      const res = await request(server)
        .post(`/schedules/${scheduleId}/cancel-session`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .set('x-studio-id', ZEN)
        .send({ reason: 'test', notifyMembers: false });
      expect(res.status).toBe(403);
    });

    it('owner cancels the session, refunding units and clearing the waitlist', async () => {
      const res = await request(server)
        .post(`/schedules/${scheduleId}/cancel-session`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ reason: 'Eğitmen hastalandı', notifyMembers: false });
      expect(res.status).toBe(201);
      expect(res.body.cancelledBookingCount).toBe(1);
      expect(res.body.cancelledWaitlistCount).toBe(1);

      const schedule = await prisma.sessionSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
      expect(schedule.isCancelled).toBe(true);
      expect(schedule.bookedCount).toBe(0);

      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('CANCELLED_EARLY');
      expect(booking.isLateCancellation).toBe(false);

      const pkg = await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkgId } });
      expect(pkg.remainingUnits).toBe(1);
      expect(pkg.status).toBe('ACTIVE');

      const waitlistEntry = await prisma.waitlist.findFirstOrThrow({ where: { scheduleId } });
      expect(waitlistEntry.status).toBe('CANCELLED');

      const auditRow = await prisma.auditLog.findFirst({
        where: { studioId: ZEN, action: 'schedule.session.cancel', entityId: scheduleId },
      });
      expect(auditRow).not.toBeNull();
    });

    it('cancelling an already-cancelled session -> 400', async () => {
      const res = await request(server)
        .post(`/schedules/${scheduleId}/cancel-session`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ notifyMembers: false });
      expect(res.status).toBe(400);
    });
  });
});
