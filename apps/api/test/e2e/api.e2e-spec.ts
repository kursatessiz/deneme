import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * End-to-end suite against a real Postgres database that has had
 * `prisma migrate deploy` and the seed (`pnpm db:seed`) applied.
 *
 * Ported 1:1 from the reference Python script (23 scenarios, same
 * assertions). Scenarios that mutate shared data create and clean up their
 * own rows so the suite can run repeatedly against the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';

interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

describe('API e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;

  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;
  let superAdminToken: string;

  // Ids of rows this suite creates, cleaned up in afterAll.
  const createdScheduleIds: string[] = [];
  const createdBookingIds: string[] = [];
  const createdPackageIds: string[] = [];

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

    ownerToken = (await login('05321000002')).accessToken; // local format, normalized server-side
    trainerToken = (await login('+905321000004')).accessToken;
    memberToken = (await login('+905321000016')).accessToken;
    superAdminToken = (await login('+905321000001')).accessToken;
  });

  afterAll(async () => {
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
    await prisma.$disconnect();
    await app.close();
  });

  it('owner /auth/me lists Zen membership with all perms', async () => {
    const res = await request(server).get('/auth/me').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const isOwnerOfZen = res.body.memberships.some((m: any) => m.studioId === ZEN && m.isOwner);
    expect(isOwnerOfZen).toBe(true);
  });

  it('owner lists own members', async () => {
    const res = await request(server)
      .get(`/members/studio/${ZEN}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
  });

  it('owner sees phones', async () => {
    const res = await request(server)
      .get(`/members/studio/${ZEN}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(JSON.stringify(res.body)).toContain('phone');
  });

  it('owner cannot list other tenant members', async () => {
    const res = await request(server)
      .get(`/members/studio/${FLOW}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it('body studioId spoofing rejected', async () => {
    const res = await request(server)
      .post('/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-studio-id', ZEN)
      .send({ studioId: FLOW, firstName: 'Xx', lastName: 'Yy', phone: '05329998877' });
    expect(res.status).toBe(403);
  });

  it('invalid body -> 400 not 500', async () => {
    const res = await request(server)
      .post('/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-studio-id', ZEN)
      .send({ studioId: ZEN, firstName: 'X' });
    expect(res.status).toBe(400);
  });

  it('wrong password -> 401', async () => {
    const res = await request(server)
      .post('/auth/login')
      .send({ emailOrPhone: '05321000002', password: 'nope12345' });
    expect(res.status).toBe(401);
  });

  it('no token -> 401', async () => {
    const res = await request(server).get(`/members/studio/${ZEN}`);
    expect(res.status).toBe(401);
  });

  it('trainer can list members', async () => {
    const res = await request(server)
      .get(`/members/studio/${ZEN}`)
      .set('Authorization', `Bearer ${trainerToken}`);
    expect(res.status).toBe(200);
  });

  it('trainer does not see phone numbers', async () => {
    const res = await request(server)
      .get(`/members/studio/${ZEN}`)
      .set('Authorization', `Bearer ${trainerToken}`);
    expect(JSON.stringify(res.body)).not.toContain('+90532');
  });

  it('trainer cannot create members', async () => {
    const res = await request(server)
      .post('/members')
      .set('Authorization', `Bearer ${trainerToken}`)
      .set('x-studio-id', ZEN)
      .send({ studioId: ZEN, firstName: 'Xx', lastName: 'Yy', phone: '05329998877' });
    expect(res.status).toBe(403);
  });

  it('member cannot list members', async () => {
    const res = await request(server)
      .get(`/members/studio/${ZEN}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });

  it('super-admin lists studios', async () => {
    const res = await request(server).get('/studios').set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
  });

  it('owner cannot list all studios', async () => {
    const res = await request(server).get('/studios').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it('public studio page', async () => {
    const res = await request(server).get('/studios/public/zen-reformer-pilates');
    expect(res.status).toBe(200);
  });

  it('public page hides internals', async () => {
    const res = await request(server).get('/studios/public/zen-reformer-pilates');
    expect(JSON.stringify(res.body)).not.toContain('notificationSettings');
  });

  describe('concurrency: package with exactly 1 unit, two parallel bookings on two schedules', () => {
    let pkgId: string;
    let memberId: string;
    let serviceTypeId: string;
    let scheduleIds: string[];
    let bookedScheduleId: string;

    // Created and torn down here (not reused from the seed) so this
    // scenario can run repeatedly against the same database: the booking
    // it exercises deliberately drains the package to DEPLETED.
    beforeAll(async () => {
      const coverage = await prisma.packageDefinitionService.findFirst({
        // No required selectable resource type: this scenario tests unit
        // depletion, not spot picking, so it must not need resourceIds.
        where: {
          unitCost: 1,
          packageDefinition: { studioId: ZEN, isActive: true },
          serviceType: { requiredResourceTypes: { none: { resourceType: { selectableByMember: true } } } },
        },
        include: { packageDefinition: true },
      });
      if (!coverage) throw new Error('seed data missing a 1-unit-cost package/service coverage for Zen with no spot requirement');
      serviceTypeId = coverage.serviceTypeId;

      const member = await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN } });
      memberId = member.id;

      const now = new Date();
      const pkg = await prisma.memberPackage.create({
        data: {
          studioId: ZEN,
          memberId,
          packageDefinitionId: coverage.packageDefinitionId,
          entitlementKind: 'SESSION_COUNT',
          totalUnits: 1,
          usedUnits: 0,
          remainingUnits: 1,
          status: 'ACTIVE',
          startDate: now,
          endDate: new Date(now.getTime() + 30 * 24 * 3600_000),
        },
      });
      pkgId = pkg.id;
      createdPackageIds.push(pkgId);

      const created = await Promise.all(
        [40, 41].map((hours) =>
          prisma.sessionSchedule.create({
            data: {
              studioId: ZEN,
              serviceTypeId,
              title: 'E2E',
              startTime: new Date(Date.now() + hours * 3600_000),
              endTime: new Date(Date.now() + hours * 3600_000 + 3600_000),
              capacity: 5,
            },
          }),
        ),
      );
      scheduleIds = created.map((s) => s.id);
      createdScheduleIds.push(...scheduleIds);
    });

    it('exactly one of two parallel bookings succeeds', async () => {
      const results = await Promise.all(
        scheduleIds.map((scheduleId) =>
          request(server)
            .post('/schedules/book')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ studioId: ZEN, scheduleId, memberId, memberPackageId: pkgId }),
        ),
      );
      const codes = results.map((r) => r.status).sort();
      const successCount = codes.filter((c) => c === 200 || c === 201).length;
      expect(successCount).toBe(1);

      results.forEach((r, i) => {
        if (r.status === 200 || r.status === 201) {
          createdBookingIds.push(r.body.id);
          // Which schedule wins the race is nondeterministic.
          bookedScheduleId = scheduleIds[i];
        }
      });
    });

    it('package never goes negative', async () => {
      const pkg = await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkgId } });
      expect(pkg.remainingUnits).toBe(0);
    });

    it('duplicate booking -> 409', async () => {
      const res = await request(server)
        .post('/schedules/book')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ studioId: ZEN, scheduleId: bookedScheduleId, memberId });
      expect(res.status).toBe(409);
    });
  });

  describe('exclusive equipment: two members, overlapping EMS sessions, same device', () => {
    let emsResourceId: string;
    let emsServiceTypeId: string;
    let scheduleA: string;
    let scheduleB: string;
    let member1: string;
    let member2: string;
    let otherTenantResourceId: string;

    beforeAll(async () => {
      const resource = await prisma.resource.findFirst({
        where: { studioId: ZEN, capacity: 1, resourceType: { name: { startsWith: 'EMS' } } },
      });
      if (!resource) throw new Error('seed data missing an EMS resource for Zen');
      emsResourceId = resource.id;

      const serviceType = await prisma.serviceType.findFirst({
        where: { studioId: ZEN, name: { startsWith: 'EMS' } },
      });
      if (!serviceType) throw new Error('seed data missing an EMS service type for Zen');
      emsServiceTypeId = serviceType.id;

      const now = Date.now();
      const [a, b] = await Promise.all([
        prisma.sessionSchedule.create({
          data: {
            studioId: ZEN,
            serviceTypeId: emsServiceTypeId,
            title: 'EMS-A',
            startTime: new Date(now + 50 * 3600_000),
            endTime: new Date(now + 50 * 3600_000 + 20 * 60_000),
            capacity: 2,
          },
        }),
        prisma.sessionSchedule.create({
          data: {
            studioId: ZEN,
            serviceTypeId: emsServiceTypeId,
            title: 'EMS-B',
            startTime: new Date(now + 50 * 3600_000 + 10 * 60_000),
            endTime: new Date(now + 50 * 3600_000 + 30 * 60_000),
            capacity: 2,
          },
        }),
      ]);
      scheduleA = a.id;
      scheduleB = b.id;
      createdScheduleIds.push(scheduleA, scheduleB);

      const members = await prisma.memberProfile.findMany({ where: { studioId: ZEN }, take: 2 });
      if (members.length < 2) throw new Error('seed data missing at least two members for Zen');
      member1 = members[0].id;
      member2 = members[1].id;

      const otherResource = await prisma.resource.findFirst({ where: { studioId: FLOW } });
      if (!otherResource) throw new Error('seed data missing a resource for Flow');
      otherTenantResourceId = otherResource.id;
    });

    it('first EMS booking ok', async () => {
      const res = await request(server)
        .post('/schedules/book')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ studioId: ZEN, scheduleId: scheduleA, memberId: member1, resourceIds: [emsResourceId] });
      expect([200, 201]).toContain(res.status);
      createdBookingIds.push(res.body.id);
    });

    it('overlapping EMS device booking -> 409', async () => {
      const res = await request(server)
        .post('/schedules/book')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ studioId: ZEN, scheduleId: scheduleB, memberId: member2, resourceIds: [emsResourceId] });
      expect(res.status).toBe(409);
    });

    it('failed booking rolled back seat', async () => {
      const schedule = await prisma.sessionSchedule.findUniqueOrThrow({ where: { id: scheduleB } });
      expect(schedule.bookedCount).toBe(0);
    });

    it('cross-tenant resource rejected', async () => {
      const res = await request(server)
        .post('/schedules/book')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          studioId: ZEN,
          scheduleId: scheduleB,
          memberId: member2,
          resourceIds: [otherTenantResourceId],
        });
      expect(res.status).toBe(400);
    });
  });
});
