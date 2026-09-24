import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { signDynamicQrToken } from '../../src/modules/checkin/dynamic-qr-token';

/**
 * W17: check-in kiosk and QR. Static branch/studio QR points, the member's
 * dynamic QR, and paired tablet kiosks. No turnstile/door integration.
 * Restores every point, kiosk device, booking and branch grant it creates.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const JWT_SECRET = process.env.JWT_SECRET as string;
const MIN = 60_000;
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';
const FLOW_OWNER_PHONE = '+905321000022';

describe('Check-in kiosk and QR (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let mainBranch: string;
  let secondBranch: string;
  let serviceTypeId: string;
  let selfMemberId: string;
  let selfMembershipId: string;
  let trainerMembershipId: string;

  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;
  let flowOwnerToken: string;

  const scheduleIds: string[] = [];
  const pointIds: string[] = [];
  const kioskDeviceIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const asZen = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
  });
  const asMe = (token: string) => ({
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
  });

  /** Creates a lone CONFIRMED booking for the demo member, offset from now by `offsetMinutes`. */
  const makeBooking = async (branchId: string, offsetMinutes: number, memberId = selfMemberId) => {
    const start = new Date(Date.now() + offsetMinutes * MIN);
    const schedule = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId,
        serviceTypeId,
        title: 'E2E check-in',
        startTime: start,
        endTime: new Date(start.getTime() + 50 * MIN),
        capacity: 4,
      },
    });
    scheduleIds.push(schedule.id);
    const booking = await prisma.booking.create({
      data: { studioId: ZEN, scheduleId: schedule.id, memberId, status: 'CONFIRMED', unitsCharged: 1 },
    });
    return { scheduleId: schedule.id, bookingId: booking.id };
  };

  const cleanupBookings = async () => {
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    scheduleIds.length = 0;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    mainBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN, name: 'Nisantasi Merkez Sube' } })).id;
    secondBranch = (await prisma.branch.findFirstOrThrow({ where: { studioId: ZEN, name: 'Kadikoy Sube' } })).id;
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, isActive: true } })).id;

    const memberProfile = await prisma.memberProfile.findFirstOrThrow({
      where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } },
    });
    selfMemberId = memberProfile.id;
    selfMembershipId = memberProfile.membershipId;
    trainerMembershipId = (
      await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: TRAINER_PHONE } } })
    ).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
  });

  afterAll(async () => {
    await cleanupBookings();
    await prisma.checkInPoint.deleteMany({ where: { id: { in: pointIds } } });
    await prisma.kioskDevice.deleteMany({ where: { id: { in: kioskDeviceIds } } });
    await asZen(ownerToken).put(`/branches/staff/${trainerMembershipId}`).send({ branchIds: [] });
    await prisma.studio.update({
      where: { id: ZEN },
      data: { checkInWindowBeforeMinutes: 30, checkInWindowAfterMinutes: 15 },
    });
    await prisma.auditLog.deleteMany({
      where: { studioId: ZEN, action: { in: ['kiosk.device.create', 'kiosk.device.pair', 'kiosk.device.revoke', 'kiosk.check-in'] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Static branch/studio QR point
  // ---------------------------------------------------------------------------

  describe('static check-in point', () => {
    let rawToken: string;
    let pointId: string;

    afterEach(cleanupBookings);

    it('owner creates a point and gets a one-time QR payload', async () => {
      const res = await asZen(ownerToken)
        .post(`/studios/${ZEN}/check-in/points`)
        .send({ branchId: mainBranch, name: 'Ana Giris' });
      expect(res.status).toBe(201);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.url).toContain(res.body.token);
      rawToken = res.body.token;
      pointId = res.body.id;
      pointIds.push(pointId);
    });

    it('member scans it inside the window (happy path) and a re-scan is idempotent', async () => {
      const { bookingId } = await makeBooking(mainBranch, 2);
      const first = await asMe(memberToken).post('/me/check-in/scan').send({ token: rawToken });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ bookingId, status: 'ATTENDED' });
      expect(first.body.checkInAt).toEqual(expect.any(String));

      const again = await asMe(memberToken).post('/me/check-in/scan').send({ token: rawToken });
      expect(again.status).toBe(201);
      expect(again.body).toMatchObject({ bookingId, status: 'ATTENDED' });
    });

    it('rejects a scan too early for the window', async () => {
      await makeBooking(mainBranch, 3 * 60);
      const res = await asMe(memberToken).post('/me/check-in/scan').send({ token: rawToken });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/henüz açılmadı/);
    });

    it('rejects a scan after the window has closed', async () => {
      await makeBooking(mainBranch, -3 * 60);
      const res = await asMe(memberToken).post('/me/check-in/scan').send({ token: rawToken });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/kapandı/);
    });

    it('rejects a deactivated point', async () => {
      await makeBooking(mainBranch, 2);
      await asZen(ownerToken).patch(`/studios/${ZEN}/check-in/points/${pointId}`).send({ isActive: false }).expect(200);
      const res = await asMe(memberToken).post('/me/check-in/scan').send({ token: rawToken });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/aktif değil/);
      await asZen(ownerToken).patch(`/studios/${ZEN}/check-in/points/${pointId}`).send({ isActive: true }).expect(200);
    });

    it('rejects a member with no membership in the point\'s studio', async () => {
      const res = await asMe(flowOwnerToken).post('/me/check-in/scan').send({ token: rawToken });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/başka bir işletmeye ait/);
    });

    it('rejects an unknown token', async () => {
      const res = await asMe(memberToken).post('/me/check-in/scan').send({ token: 'x'.repeat(32) });
      expect(res.status).toBe(404);
    });

    it('rotating the point invalidates the old QR', async () => {
      await makeBooking(mainBranch, 2);
      const rotated = await asZen(ownerToken).post(`/studios/${ZEN}/check-in/points/${pointId}/rotate`).send({});
      expect(rotated.status).toBe(201);
      expect(rotated.body.token).not.toBe(rawToken);

      const stale = await asMe(memberToken).post('/me/check-in/scan').send({ token: rawToken });
      expect(stale.status).toBe(404);

      const fresh = await asMe(memberToken).post('/me/check-in/scan').send({ token: rotated.body.token });
      expect(fresh.status).toBe(201);
      rawToken = rotated.body.token;
    });
  });

  // ---------------------------------------------------------------------------
  // Dynamic member QR (staff scan)
  // ---------------------------------------------------------------------------

  describe('dynamic member QR', () => {
    afterEach(cleanupBookings);

    it('member requests a signed, short-lived QR token', async () => {
      const res = await asMe(memberToken).post('/me/check-in/qr').send({ studioId: ZEN });
      expect(res.status).toBe(201);
      expect(res.body.token.split('.')).toHaveLength(2);
      expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('staff scans it and the matching booking is checked in (happy path)', async () => {
      const { bookingId } = await makeBooking(mainBranch, 2);
      const issued = await asMe(memberToken).post('/me/check-in/qr').send({ studioId: ZEN });
      const res = await asZen(trainerToken).post(`/studios/${ZEN}/check-in/member-qr`).send({ token: issued.body.token });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ resolved: true, bookingId, status: 'ATTENDED' });
    });

    it('rejects an expired token', async () => {
      const { token } = signDynamicQrToken(JWT_SECRET, selfMembershipId, ZEN, Date.now() - 120_000);
      const res = await asZen(trainerToken).post(`/studios/${ZEN}/check-in/member-qr`).send({ token });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/süresi doldu/);
    });

    it('rejects a tampered token', async () => {
      const { token } = signDynamicQrToken(JWT_SECRET, selfMembershipId, ZEN);
      const [body, signature] = token.split('.');
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      payload.membershipId = trainerMembershipId; // try to impersonate someone else
      const tamperedBody = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      const res = await asZen(trainerToken)
        .post(`/studios/${ZEN}/check-in/member-qr`)
        .send({ token: `${tamperedBody}.${signature}` });
      expect(res.status).toBe(400);
    });

    it('rejects replaying the same token twice', async () => {
      await makeBooking(mainBranch, 2);
      const issued = await asMe(memberToken).post('/me/check-in/qr').send({ studioId: ZEN });
      const first = await asZen(trainerToken).post(`/studios/${ZEN}/check-in/member-qr`).send({ token: issued.body.token });
      expect(first.status).toBe(201);
      const replay = await asZen(trainerToken).post(`/studios/${ZEN}/check-in/member-qr`).send({ token: issued.body.token });
      expect(replay.status).toBe(409);
    });

    it('rejects a token minted for a different studio', async () => {
      const { token } = signDynamicQrToken(JWT_SECRET, selfMembershipId, FLOW);
      const res = await asZen(trainerToken).post(`/studios/${ZEN}/check-in/member-qr`).send({ token });
      expect(res.status).toBe(403);
    });

    it('denies a branch-restricted staff member acting outside their branch', async () => {
      const { scheduleId } = await makeBooking(mainBranch, 2);
      await asZen(ownerToken).put(`/branches/staff/${trainerMembershipId}`).send({ branchIds: [secondBranch] }).expect(200);
      const issued = await asMe(memberToken).post('/me/check-in/qr').send({ studioId: ZEN });
      const res = await asZen(trainerToken)
        .post(`/studios/${ZEN}/check-in/member-qr`)
        .send({ token: issued.body.token, scheduleId });
      expect(res.status).toBe(403);
      await asZen(ownerToken).put(`/branches/staff/${trainerMembershipId}`).send({ branchIds: [] }).expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Kiosk
  // ---------------------------------------------------------------------------

  describe('kiosk', () => {
    let kioskToken: string;
    let deviceId: string;

    afterEach(cleanupBookings);

    it('owner pairs a kiosk device and the tablet exchanges the code for a kiosk token', async () => {
      const created = await asZen(ownerToken).post(`/studios/${ZEN}/kiosk-devices`).send({ branchId: mainBranch, name: 'Resepsiyon Tablet' });
      expect(created.status).toBe(201);
      deviceId = created.body.id;
      kioskDeviceIds.push(deviceId);

      const paired = await request(server).post('/kiosk/pair').send({ pairingCode: created.body.pairingCode });
      expect(paired.status).toBe(201);
      expect(paired.body.token).toEqual(expect.any(String));
      kioskToken = paired.body.token;

      const replay = await request(server).post('/kiosk/pair').send({ pairingCode: created.body.pairingCode });
      expect(replay.status).toBe(400);
    });

    it('lists today\'s sessions for the kiosk\'s branch', async () => {
      await makeBooking(mainBranch, 2);
      const res = await request(server).get('/kiosk/sessions/today').set('Authorization', `Bearer ${kioskToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('checks a member in by dynamic QR and writes an audit log entry', async () => {
      const { bookingId } = await makeBooking(mainBranch, 2);
      const issued = await asMe(memberToken).post('/me/check-in/qr').send({ studioId: ZEN });
      const res = await request(server).post('/kiosk/check-in').set('Authorization', `Bearer ${kioskToken}`).send({ token: issued.body.token });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ resolved: true, bookingId });

      const audit = await prisma.auditLog.findFirst({ where: { studioId: ZEN, action: 'kiosk.check-in', entityId: bookingId } });
      expect(audit).not.toBeNull();
    });

    it('a kiosk token cannot call a normal studio-scoped endpoint', async () => {
      const res = await request(server)
        .get(`/schedules/studio/${ZEN}`)
        .set('Authorization', `Bearer ${kioskToken}`)
        .set('x-studio-id', ZEN)
        .query({ startDate: new Date().toISOString(), endDate: new Date(Date.now() + 86_400_000).toISOString() });
      expect(res.status).toBe(401);
    });

    it('a normal staff access token cannot call a kiosk endpoint', async () => {
      const res = await request(server).get('/kiosk/sessions/today').set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(401);
    });

    it('denies a revoked kiosk immediately', async () => {
      await asZen(ownerToken).post(`/studios/${ZEN}/kiosk-devices/${deviceId}/revoke`).send({}).expect(201);
      const res = await request(server).get('/kiosk/sessions/today').set('Authorization', `Bearer ${kioskToken}`);
      expect(res.status).toBe(401);
    });
  });
});
