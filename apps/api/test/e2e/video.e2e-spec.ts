import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * W19: live online sessions (join links) and the on-demand video library.
 * Builds deterministic fixtures in the Zen studio and never touches seed data.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const MINUTE = 60_000;
const HOUR = 3600_000;
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';

describe('Video: live sessions and on-demand library (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;

  let mainBranch: string;
  let trainerId: string;
  let serviceTypeId: string;
  let memberId: string;
  let creditPackageDefId: string;

  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];
  const contentIds: string[] = [];
  const memberPackageIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId = ZEN) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  const makeOnlineSchedule = async (start: Date, meetingUrl = 'https://meet.example.com/e2e-room') => {
    const s = await prisma.sessionSchedule.create({
      data: {
        studioId: ZEN,
        branchId: mainBranch,
        serviceTypeId,
        trainerId,
        title: 'E2E canli seans',
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        capacity: 6,
        deliveryMode: 'ONLINE',
        meetingProvider: 'MANUAL',
        meetingUrl,
      },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  const makeBooking = async (scheduleId: string, member: string, status: 'CONFIRMED' | 'ATTENDED' = 'CONFIRMED') => {
    const b = await prisma.booking.create({ data: { studioId: ZEN, scheduleId, memberId: member, status } });
    bookingIds.push(b.id);
    return b.id;
  };

  const makeCreditPackage = async (remainingUnits: number) => {
    const mp = await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId,
        packageDefinitionId: creditPackageDefId,
        entitlementKind: 'CREDIT',
        totalUnits: remainingUnits,
        remainingUnits,
        status: 'ACTIVE',
        endDate: new Date(Date.now() + 30 * 24 * HOUR),
      },
    });
    memberPackageIds.push(mp.id);
    return mp.id;
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
    serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN, isActive: true } })).id;
    trainerId = (await prisma.trainerProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: TRAINER_PHONE } } } })).id;
    memberId = (await prisma.memberProfile.findFirstOrThrow({ where: { studioId: ZEN, membership: { user: { phone: MEMBER_PHONE } } } })).id;
    creditPackageDefId = (await prisma.packageDefinition.findFirstOrThrow({ where: { studioId: ZEN, entitlementKind: 'CREDIT' } })).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
  });

  afterAll(async () => {
    // Joining a session marks attendance through the real check-in path, so
    // it also runs W16 gamification evaluation for this member - clean up
    // any badges it awarded so other suites (e.g. gamification.e2e-spec)
    // still find this member's badge state untouched by this file.
    await prisma.memberBadge.deleteMany({ where: { studioId: ZEN, memberId } });
    await prisma.videoView.deleteMany({ where: { studioId: ZEN, videoContentId: { in: contentIds } } });
    await prisma.videoContentPackage.deleteMany({ where: { videoContentId: { in: contentIds } } });
    await prisma.videoContent.deleteMany({ where: { id: { in: contentIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: memberPackageIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('meeting link https-only validation', () => {
    it('rejects a non-https manual meeting URL when creating a session', async () => {
      const res = await as(ownerToken).post('/schedules').send({
        studioId: ZEN,
        serviceTypeId,
        trainerId,
        branchId: mainBranch,
        title: 'E2E http reddi',
        startTime: new Date(Date.now() + HOUR).toISOString(),
        endTime: new Date(Date.now() + 2 * HOUR).toISOString(),
        deliveryMode: 'ONLINE',
        meetingProvider: 'MANUAL',
        manualMeetingUrl: 'http://not-secure.example.com/room',
      });
      expect(res.status).toBe(400);
    });

    it('generates an unguessable JITSI room URL when no manual URL is given', async () => {
      const res = await as(ownerToken).post('/schedules').send({
        studioId: ZEN,
        serviceTypeId,
        trainerId,
        branchId: mainBranch,
        title: 'E2E jitsi',
        startTime: new Date(Date.now() + HOUR).toISOString(),
        endTime: new Date(Date.now() + 2 * HOUR).toISOString(),
        deliveryMode: 'ONLINE',
        meetingProvider: 'JITSI',
      });
      expect(res.status).toBe(201);
      scheduleIds.push(res.body.id);
      expect(res.body.meetingUrl).toMatch(/^https:\/\//);
    });
  });

  describe('join link visibility', () => {
    it('never appears in the staff calendar listing', async () => {
      const scheduleId = await makeOnlineSchedule(new Date(Date.now() + HOUR));
      const list = await as(ownerToken).get(
        `/schedules/studio/${ZEN}?startDate=${new Date(Date.now() - HOUR).toISOString()}&endDate=${new Date(Date.now() + 2 * HOUR).toISOString()}`,
      );
      expect(list.status).toBe(200);
      const found = list.body.find((s: any) => s.id === scheduleId);
      expect(found).toBeTruthy();
      expect(found.meetingUrl).toBeUndefined();
      expect(found.meetingProvider).toBeUndefined();
    });

    it('never appears in the member self-service week listing', async () => {
      const scheduleId = await makeOnlineSchedule(new Date(Date.now() + HOUR));
      const list = await as(memberToken).get(
        `/schedules/self/week?startDate=${new Date(Date.now() - HOUR).toISOString()}&endDate=${new Date(Date.now() + 2 * HOUR).toISOString()}`,
      );
      expect(list.status).toBe(200);
      const found = list.body.find((s: any) => s.id === scheduleId);
      expect(found).toBeTruthy();
      expect(found.meetingUrl).toBeUndefined();
    });

    it('rejects joining without a confirmed booking (403)', async () => {
      const scheduleId = await makeOnlineSchedule(new Date(Date.now() + 5 * MINUTE));
      const res = await as(memberToken).post(`/schedules/sessions/${scheduleId}/join`);
      expect(res.status).toBe(403);
    });

    it('enforces the join window: too early is rejected', async () => {
      const scheduleId = await makeOnlineSchedule(new Date(Date.now() + HOUR));
      await makeBooking(scheduleId, memberId, 'CONFIRMED');
      const res = await as(memberToken).post(`/schedules/sessions/${scheduleId}/join`);
      expect(res.status).toBe(400);
    });

    it('lets a confirmed member join once the window opens and marks attendance exactly once', async () => {
      const scheduleId = await makeOnlineSchedule(new Date(Date.now() + 10 * MINUTE));
      const bookingId = await makeBooking(scheduleId, memberId, 'CONFIRMED');

      const res = await as(memberToken).post(`/schedules/sessions/${scheduleId}/join`);
      expect(res.status).toBe(201);
      expect(res.body.joinUrl).toMatch(/^https:\/\//);

      const attended = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(attended.status).toBe('ATTENDED');
      const firstCheckInAt = attended.checkInAt;
      expect(firstCheckInAt).not.toBeNull();

      // Joining again (already ATTENDED) must not fail and must not re-check-in.
      const again = await as(memberToken).post(`/schedules/sessions/${scheduleId}/join`);
      expect(again.status).toBe(201);
      const stillAttended = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(stillAttended.checkInAt?.getTime()).toBe(firstCheckInAt?.getTime());
    });

    it('rejects joining after the session has ended', async () => {
      const scheduleId = await makeOnlineSchedule(new Date(Date.now() - 2 * HOUR));
      await makeBooking(scheduleId, memberId, 'CONFIRMED');
      const res = await as(memberToken).post(`/schedules/sessions/${scheduleId}/join`);
      expect(res.status).toBe(400);
    });

    it('rejects joining an IN_PERSON session (400)', async () => {
      const s = await prisma.sessionSchedule.create({
        data: {
          studioId: ZEN,
          branchId: mainBranch,
          serviceTypeId,
          trainerId,
          title: 'E2E yuz yuze',
          startTime: new Date(Date.now() + 10 * MINUTE),
          endTime: new Date(Date.now() + HOUR),
          capacity: 6,
        },
      });
      scheduleIds.push(s.id);
      await makeBooking(s.id, memberId, 'CONFIRMED');
      const res = await as(memberToken).post(`/schedules/sessions/${s.id}/join`);
      expect(res.status).toBe(400);
    });

    it('cross-tenant: a ZEN owner has no membership in FLOW and is denied (403)', async () => {
      const scheduleId = await makeOnlineSchedule(new Date(Date.now() + HOUR));
      const res = await as(ownerToken, FLOW).patch(`/schedules/${scheduleId}/meeting`).send({
        deliveryMode: 'ONLINE',
        meetingProvider: 'JITSI',
      });
      expect(res.status).toBe(403);
    });
  });

  describe('on-demand video content: staff CRUD, publish, permissions', () => {
    it('staff without content.manage cannot create content (403)', async () => {
      const res = await as(trainerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'Yasak icerik',
        durationSeconds: 600,
        sourceUrl: 'https://videos.example.com/yasak',
      });
      expect(res.status).toBe(403);
    });

    it('rejects a non-https sourceUrl', async () => {
      const res = await as(ownerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'Guvensiz baglanti',
        durationSeconds: 600,
        sourceUrl: 'http://videos.example.com/guvensiz',
      });
      expect(res.status).toBe(400);
    });

    it('owner creates, publishes and unpublishes content', async () => {
      const create = await as(ownerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'E2E Temel Pilates Videosu',
        description: 'Baslangic seviyesi',
        durationSeconds: 1200,
        sourceUrl: 'https://videos.example.com/e2e-temel-pilates',
        visibility: 'ALL_MEMBERS',
      });
      expect(create.status).toBe(201);
      expect(create.body.isPublished).toBe(false);
      contentIds.push(create.body.id);

      const publish = await as(ownerToken).post(`/video/content/studio/${ZEN}/${create.body.id}/publish`);
      expect(publish.status).toBe(201);
      expect(publish.body.isPublished).toBe(true);
      expect(publish.body.publishedAt).toBeTruthy();

      const memberList = await as(memberToken).get(`/video/content/self`);
      expect(memberList.status).toBe(200);
      expect(memberList.body.find((c: any) => c.id === create.body.id)).toBeTruthy();

      const unpublish = await as(ownerToken).post(`/video/content/studio/${ZEN}/${create.body.id}/unpublish`);
      expect(unpublish.status).toBe(201);

      const memberListAfter = await as(memberToken).get(`/video/content/self`);
      expect(memberListAfter.body.find((c: any) => c.id === create.body.id)).toBeFalsy();
    });

    it('cross-tenant: a FLOW owner cannot see ZEN content in staff listing', async () => {
      const create = await as(ownerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'E2E Cross Tenant Video',
        durationSeconds: 300,
        sourceUrl: 'https://videos.example.com/e2e-cross-tenant',
      });
      expect(create.status).toBe(201);
      contentIds.push(create.body.id);

      // The ZEN owner has no membership in FLOW, so this is denied outright
      // rather than returning an empty/filtered list - studioId is never
      // trusted from the caller, only from a verified membership.
      const flowList = await as(ownerToken, FLOW).get(`/video/content/studio/${FLOW}`);
      expect(flowList.status).toBe(403);
    });
  });

  describe('on-demand video content: visibility per package', () => {
    it('locks SPECIFIC_PACKAGES content for a member without the required package', async () => {
      const create = await as(ownerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'E2E Ozel Paket Videosu',
        durationSeconds: 900,
        sourceUrl: 'https://videos.example.com/e2e-ozel-paket',
        visibility: 'SPECIFIC_PACKAGES',
        packageDefinitionIds: [creditPackageDefId],
      });
      expect(create.status).toBe(201);
      contentIds.push(create.body.id);
      await as(ownerToken).post(`/video/content/studio/${ZEN}/${create.body.id}/publish`);

      const list = await as(memberToken).get(`/video/content/self`);
      const card = list.body.find((c: any) => c.id === create.body.id);
      expect(card).toBeTruthy();
      expect(card.isLocked).toBe(true);
      expect(card.sourceUrl).toBeNull();

      const start = await as(memberToken).post(`/video/content/self/${create.body.id}/start`).send({});
      expect(start.status).toBe(403);
    });

    it('unlocks once the member holds an active matching package', async () => {
      const create = await as(ownerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'E2E Kredi Paket Videosu',
        durationSeconds: 900,
        sourceUrl: 'https://videos.example.com/e2e-kredi-paket',
        visibility: 'SPECIFIC_PACKAGES',
        packageDefinitionIds: [creditPackageDefId],
      });
      contentIds.push(create.body.id);
      await as(ownerToken).post(`/video/content/studio/${ZEN}/${create.body.id}/publish`);
      await makeCreditPackage(10);

      const list = await as(memberToken).get(`/video/content/self`);
      const card = list.body.find((c: any) => c.id === create.body.id);
      expect(card.isLocked).toBe(false);
      expect(card.sourceUrl).toMatch(/^https:\/\//);
    });
  });

  describe('on-demand video content: credit charging', () => {
    it('does not charge units by default (no creditCost)', async () => {
      const create = await as(ownerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'E2E Ucretsiz Video',
        durationSeconds: 600,
        sourceUrl: 'https://videos.example.com/e2e-ucretsiz',
        visibility: 'ALL_MEMBERS',
      });
      contentIds.push(create.body.id);
      await as(ownerToken).post(`/video/content/studio/${ZEN}/${create.body.id}/publish`);

      const start = await as(memberToken).post(`/video/content/self/${create.body.id}/start`).send({});
      expect(start.status).toBe(201);
      expect(start.body.charged).toBe(false);
    });

    it('returns 409 when the package has insufficient credit', async () => {
      const create = await as(ownerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'E2E Yetersiz Kredi Videosu',
        durationSeconds: 600,
        sourceUrl: 'https://videos.example.com/e2e-yetersiz-kredi',
        visibility: 'ALL_MEMBERS',
        creditCost: 5,
      });
      contentIds.push(create.body.id);
      await as(ownerToken).post(`/video/content/studio/${ZEN}/${create.body.id}/publish`);
      const pkgId = await makeCreditPackage(2); // less than creditCost

      const res = await as(memberToken).post(`/video/content/self/${create.body.id}/start`).send({ memberPackageId: pkgId });
      expect(res.status).toBe(409);

      const pkg = await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkgId } });
      expect(pkg.remainingUnits).toBe(2); // untouched
    });

    it('charges exactly once under two parallel start requests', async () => {
      const create = await as(ownerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'E2E Paralel Kredi Videosu',
        durationSeconds: 600,
        sourceUrl: 'https://videos.example.com/e2e-paralel-kredi',
        visibility: 'ALL_MEMBERS',
        creditCost: 4,
      });
      contentIds.push(create.body.id);
      await as(ownerToken).post(`/video/content/studio/${ZEN}/${create.body.id}/publish`);
      const pkgId = await makeCreditPackage(10);

      const [r1, r2] = await Promise.all([
        as(memberToken).post(`/video/content/self/${create.body.id}/start`).send({ memberPackageId: pkgId }),
        as(memberToken).post(`/video/content/self/${create.body.id}/start`).send({ memberPackageId: pkgId }),
      ]);
      expect([r1.status, r2.status].every((s) => s === 201)).toBe(true);
      const chargedCount = [r1.body.charged, r2.body.charged].filter(Boolean).length;
      expect(chargedCount).toBe(1);

      const pkg = await prisma.memberPackage.findUniqueOrThrow({ where: { id: pkgId } });
      expect(pkg.remainingUnits).toBe(6); // charged exactly once, not twice
    });

    it('records watch progress for resume', async () => {
      const create = await as(ownerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'E2E Devam Videosu',
        durationSeconds: 600,
        sourceUrl: 'https://videos.example.com/e2e-devam',
        visibility: 'ALL_MEMBERS',
      });
      contentIds.push(create.body.id);
      await as(ownerToken).post(`/video/content/studio/${ZEN}/${create.body.id}/publish`);
      await as(memberToken).post(`/video/content/self/${create.body.id}/start`).send({});

      const progress = await as(memberToken).post(`/video/content/self/${create.body.id}/progress`).send({
        positionSeconds: 245,
        completed: false,
      });
      expect(progress.status).toBe(201);
      expect(progress.body.lastPositionSeconds).toBe(245);
    });
  });

  describe('reports', () => {
    it('reports views/completions/unique viewers, owner-only (content.view)', async () => {
      const create = await as(ownerToken).post(`/video/content/studio/${ZEN}`).send({
        title: 'E2E Rapor Videosu',
        durationSeconds: 600,
        sourceUrl: 'https://videos.example.com/e2e-rapor',
        visibility: 'ALL_MEMBERS',
      });
      contentIds.push(create.body.id);
      await as(ownerToken).post(`/video/content/studio/${ZEN}/${create.body.id}/publish`);
      await as(memberToken).post(`/video/content/self/${create.body.id}/start`).send({});
      await as(memberToken).post(`/video/content/self/${create.body.id}/progress`).send({ positionSeconds: 600, completed: true });

      const denied = await as(trainerToken).get(`/video/content/studio/${ZEN}/reports`);
      expect(denied.status).toBe(403);

      const res = await as(ownerToken).get(`/video/content/studio/${ZEN}/reports`);
      expect(res.status).toBe(200);
      const row = res.body.find((r: any) => r.contentId === create.body.id);
      expect(row).toEqual({ contentId: create.body.id, title: 'E2E Rapor Videosu', views: 1, completions: 1, uniqueViewers: 1 });
    });
  });
});
