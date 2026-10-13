import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * Scheduling integrity: simultaneous creates cannot double-book a trainer,
 * moving a session moves its spot holds, a capacity increase promotes the
 * waitlist, sessions that ended cannot be booked, and a service's minimum
 * repeat interval is enforced. Builds its own sessions far in the future (or
 * in the past where the test needs it) and removes everything it created.
 */
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe('Scheduling integrity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;
  let ZEN: string;
  let ownerToken: string;
  let serviceTypeId: string;
  let trainerId: string;
  let resourceId: string;
  let memberA: string;
  let memberB: string;
  const scheduleIds: string[] = [];
  const serviceTypeIds: string[] = [];
  const packageDefinitionIds: string[] = [];
  const auditEntityIds: string[] = [];
  let base = Date.UTC(2032, 2, 1, 10, 0, 0);

  const api = (method: 'get' | 'post' | 'patch', url: string, body?: unknown) =>
    request(server)[method](url).set('Authorization', `Bearer ${ownerToken}`).set('x-studio-id', ZEN).send(body ?? {});

  /** A fresh, non-overlapping slot per call. */
  const nextSlot = () => {
    const start = new Date((base += 2 * DAY));
    return { start, end: new Date(start.getTime() + HOUR) };
  };

  const makeSchedule = async (opts: { start?: Date; end?: Date; capacity?: number; serviceTypeId?: string } = {}) => {
    const slot = nextSlot();
    const start = opts.start ?? slot.start;
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        serviceTypeId: opts.serviceTypeId ?? serviceTypeId,
        title: 'E2E scheduling integrity',
        startTime: start,
        endTime: opts.end ?? new Date(start.getTime() + HOUR),
        capacity: opts.capacity ?? 5,
      },
    });
    scheduleIds.push(s.id);
    return s;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    const login = await request(server).post('/auth/login').send({ emailOrPhone: OWNER_PHONE, password: DEMO_PASSWORD });
    ownerToken = login.body.accessToken;
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, isActive: true, requiredResourceTypes: { none: {} } } })).id;
    trainerId = (await prisma.trainerProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { status: 'ACTIVE' } } })).id;
    resourceId = (await prisma.resource.findFirstOrThrow({ where: { studioId: ZEN, capacity: 1, isMaintenance: false } })).id;
    const members = await prisma.memberProfile.findMany({
      where: { studioId: ZEN, membership: { status: 'ACTIVE', isPartnerGuest: false } },
      take: 2,
    });
    memberA = members[0].id;
    memberB = members[1].id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'booking.repeat_interval_override', entityId: { in: auditEntityIds } } });
    await prisma.waitlist.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.memberPackage.deleteMany({ where: { packageDefinitionId: { in: packageDefinitionIds } } });
    await prisma.packageDefinition.deleteMany({ where: { id: { in: packageDefinitionIds } } });
    await prisma.serviceType.deleteMany({ where: { id: { in: serviceTypeIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('two simultaneous creates for the same trainer and time: one 201, one 409', async () => {
    const { start, end } = nextSlot();
    const body = { studioId: ZEN, serviceTypeId, trainerId, title: 'E2E concurrent create', startTime: start.toISOString(), endTime: end.toISOString() };
    const results = await Promise.all(Array.from({ length: 4 }, () => api('post', '/schedules', body)));
    for (const r of results) if (r.status === 201) scheduleIds.push(r.body.id);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
  });

  it('moving a session moves its spot holds, freeing the old time', async () => {
    const first = await makeSchedule();
    const booked = await api('post', '/schedules/book', { studioId: ZEN, scheduleId: first.id, memberId: memberA, resourceIds: [resourceId], chargePackage: false });
    expect(booked.status).toBe(201);

    const moved = nextSlot();
    const patch = await api('patch', `/schedules/${first.id}`, { startTime: moved.start.toISOString(), endTime: moved.end.toISOString() });
    expect(patch.status).toBe(200);
    const hold = await prisma.bookingResource.findFirstOrThrow({ where: { bookingId: booked.body.id } });
    expect(hold.startTime.toISOString()).toBe(moved.start.toISOString());
    expect(hold.endTime.toISOString()).toBe(moved.end.toISOString());

    // The old slot is free for the same spot again.
    const other = await makeSchedule({ start: first.startTime, end: first.endTime });
    const again = await api('post', '/schedules/book', { studioId: ZEN, scheduleId: other.id, memberId: memberB, resourceIds: [resourceId], chargePackage: false });
    expect(again.status).toBe(201);

    // Moving the second session onto the first one's new slot collides with the held spot.
    const clash = await api('patch', `/schedules/${other.id}`, { startTime: moved.start.toISOString(), endTime: moved.end.toISOString() });
    expect(clash.status).toBe(409);
  });

  it('a capacity increase promotes the waitlist', async () => {
    const full = await makeSchedule({ capacity: 1 });
    expect((await api('post', '/schedules/book', { studioId: ZEN, scheduleId: full.id, memberId: memberA, resourceIds: [], chargePackage: false })).status).toBe(201);
    // The promotion books the waiting member system-side, which charges a package like any booking: give them one.
    // Use a kind the service accepts (the seeded resource-free service may allow only TIME_UNLIMITED).
    const service = await prisma.serviceType.findUniqueOrThrow({ where: { id: serviceTypeId }, select: { allowedEntitlementKinds: true } });
    const kind = service.allowedEntitlementKinds.includes('SESSION_COUNT') ? 'SESSION_COUNT' : service.allowedEntitlementKinds[0];
    const units = kind === 'TIME_UNLIMITED' ? null : 1;
    const definition = await prisma.packageDefinition.create({
      data: {
        studioId: ZEN,
        name: `E2E integrity ${Date.now().toString(36)}`,
        entitlementKind: kind,
        totalUnits: units,
        validityDays: 30,
        price: 0,
        services: { create: { serviceTypeId, unitCost: 1 } },
      },
    });
    packageDefinitionIds.push(definition.id);
    await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId: memberB,
        packageDefinitionId: definition.id,
        entitlementKind: kind,
        totalUnits: units,
        remainingUnits: units,
        endDate: new Date(Date.now() + 30 * DAY),
      },
    });
    await prisma.waitlist.create({ data: { studioId: ZEN, scheduleId: full.id, memberId: memberB, position: 1, status: 'WAITING' } });

    const patch = await api('patch', `/schedules/${full.id}`, { capacity: 2 });
    expect(patch.status).toBe(200);
    const booking = await prisma.booking.findFirst({ where: { scheduleId: full.id, memberId: memberB } });
    expect(booking?.status).toBe('CONFIRMED');
    const entry = await prisma.waitlist.findFirstOrThrow({ where: { scheduleId: full.id, memberId: memberB } });
    expect(entry.status).toBe('PROMOTED');
  });

  it('staff cannot book a session that already ended', async () => {
    const past = new Date(Date.now() - 3 * HOUR);
    const ended = await makeSchedule({ start: past, end: new Date(past.getTime() + HOUR) });
    const res = await api('post', '/schedules/book', { studioId: ZEN, scheduleId: ended.id, memberId: memberA, resourceIds: [] });
    expect(res.status).toBe(400);
  });

  it('enforces the minimum repeat interval of a service in both directions', async () => {
    const service = await prisma.serviceType.create({
      data: { studioId: ZEN, name: 'E2E repeat interval', durationMin: 60, capacity: 5, minRepeatIntervalDays: 2 },
    });
    serviceTypeIds.push(service.id);
    const t0 = nextSlot().start;
    const day0 = await makeSchedule({ start: t0, serviceTypeId: service.id });
    const day1 = await makeSchedule({ start: new Date(t0.getTime() + DAY), serviceTypeId: service.id });
    const day3 = await makeSchedule({ start: new Date(t0.getTime() + 3 * DAY), serviceTypeId: service.id });
    // These services have no package: the test is about the repeat rule, so staff book without charging.
    const bookOn = (id: string) => api('post', '/schedules/book', { studioId: ZEN, scheduleId: id, memberId: memberA, resourceIds: [], chargePackage: false });

    expect((await bookOn(day0.id)).status).toBe(201);
    expect((await bookOn(day1.id)).status).toBe(400);
    expect((await bookOn(day3.id)).status).toBe(201);
    // Day 1 is within two days of both day 0 and day 3.
    expect((await bookOn(day1.id)).status).toBe(400);
  });

  describe('minimum repeat interval: staff override and no-show notice', () => {
    let service: { id: string };
    let t0: Date;
    const bookOn = (id: string, extra: Record<string, unknown> = {}, member = memberA) =>
      api('post', '/schedules/book', { studioId: ZEN, scheduleId: id, memberId: member, resourceIds: [], chargePackage: false, ...extra });

    beforeAll(async () => {
      service = await prisma.serviceType.create({
        data: { studioId: ZEN, name: 'E2E repeat override', durationMin: 60, capacity: 5, minRepeatIntervalDays: 2 },
      });
      serviceTypeIds.push(service.id);
      t0 = nextSlot().start;
    });

    it('staff without the override flag gets 400 with the rule code and the conflicting session date', async () => {
      const first = await makeSchedule({ start: t0, serviceTypeId: service.id });
      const close = await makeSchedule({ start: new Date(t0.getTime() + DAY), serviceTypeId: service.id });
      expect((await bookOn(first.id)).status).toBe(201);
      const res = await bookOn(close.id);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('apiErrors.schedules.minRepeatIntervalNotElapsed');
      expect(res.body.params).toMatchObject({ count: 2, date: first.startTime.toISOString() });
    });

    it('staff with overrideRepeatInterval books anyway and an audit row is written', async () => {
      const first = await makeSchedule({ start: new Date(t0.getTime() + 10 * DAY), serviceTypeId: service.id });
      const close = await makeSchedule({ start: new Date(t0.getTime() + 11 * DAY), serviceTypeId: service.id });
      const firstBooking = await bookOn(first.id, {}, memberB);
      expect(firstBooking.status).toBe(201);
      const res = await bookOn(close.id, { overrideRepeatInterval: true }, memberB);
      expect(res.status).toBe(201);
      auditEntityIds.push(res.body.id);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { studioId: ZEN, action: 'booking.repeat_interval_override', entityId: res.body.id } });
      expect(audit.userId).toBeTruthy();
      expect(audit.metadata).toMatchObject({
        serviceTypeId: service.id,
        memberId: memberB,
        scheduleId: close.id,
        conflictingBookingId: firstBooking.body.id,
      });
    });

    it('a member cannot override the rule: 403 even when the rule would not fire', async () => {
      const login = await request(server).post('/auth/login').send({ emailOrPhone: '+905321000016', password: DEMO_PASSWORD });
      const memberToken = login.body.accessToken as string;
      const self = await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: '+905321000016' } } } });
      const sched = await makeSchedule({ start: new Date(t0.getTime() + 20 * DAY), serviceTypeId: service.id });
      const res = await request(server)
        .post('/schedules/book/self')
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, scheduleId: sched.id, memberId: self.id, resourceIds: [], overrideRepeatInterval: true });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('apiErrors.schedules.repeatOverrideNotAllowed');
      expect(await prisma.booking.count({ where: { scheduleId: sched.id } })).toBe(0);
    });

    it('a NO_SHOW inside the window does not block, and the response carries a notice', async () => {
      const missed = await makeSchedule({ start: new Date(t0.getTime() + 30 * DAY), serviceTypeId: service.id });
      const next = await makeSchedule({ start: new Date(t0.getTime() + 31 * DAY), serviceTypeId: service.id });
      await prisma.booking.create({ data: { studioId: ZEN, scheduleId: missed.id, memberId: memberA, status: 'NO_SHOW' } });
      const res = await bookOn(next.id, {}, memberA);
      expect(res.status).toBe(201);
      expect(res.body.notices).toHaveLength(1);
      expect(res.body.notices[0]).toMatchObject({ code: 'apiTexts.schedules.noShowInWindowNotice' });
      expect(res.body.notices[0].message).toContain(String(res.body.notices[0].params.date));
    });

    it('a booking with nothing to report has an empty notices list', async () => {
      const lone = await makeSchedule({ start: new Date(t0.getTime() + 40 * DAY), serviceTypeId: service.id });
      const res = await bookOn(lone.id, {}, memberB);
      expect(res.status).toBe(201);
      expect(res.body.notices).toEqual([]);
    });
  });
});
