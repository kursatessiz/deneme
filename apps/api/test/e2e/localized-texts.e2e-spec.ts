import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * Texts the API writes itself (docs/I18N.md, "API metinleri"): a notification
 * is written in its recipient's language, a response in the requester's
 * language (Accept-Language), and a validation failure carries the key of
 * every field message.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const HOUR = 3600_000;

describe('Localized API texts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let ZEN: string;
  let ownerToken: string;

  let serviceTypeId: string;
  let policyId: string;
  let packageDefinitionId: string;
  let englishMemberId: string;
  let turkishMemberId: string;
  let englishUserId: string;
  let turkishUserId: string;
  let previousEnglishLocale: string | null;
  let previousTurkishLocale: string | null;

  const scheduleIds: string[] = [];
  const packageIds: string[] = [];
  const deviceTokens: string[] = [];

  const as = (token: string) => ({
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
  });

  const makeSchedule = async (startInHours: number, capacity: number) => {
    const start = new Date(Date.now() + startInHours * HOUR);
    const s = await prisma.sessionSchedule.create({
      data: { studioId: ZEN, serviceTypeId, title: 'E2E locale', startTime: start, endTime: new Date(start.getTime() + HOUR), capacity },
    });
    scheduleIds.push(s.id);
    return s.id;
  };

  const makePackage = async (memberId: string) => {
    const p = await prisma.memberPackage.create({
      data: {
        studioId: ZEN,
        memberId,
        packageDefinitionId,
        entitlementKind: 'CREDIT',
        totalUnits: 6,
        remainingUnits: 6,
        endDate: new Date(Date.now() + 30 * 24 * HOUR),
      },
    });
    packageIds.push(p.id);
    return p.id;
  };

  const book = (memberId: string, scheduleId: string, memberPackageId: string) =>
    as(ownerToken).post('/schedules/book').send({ studioId: ZEN, scheduleId, memberId, memberPackageId });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    const login = await request(server).post('/auth/login').send({ emailOrPhone: '+905321000002', password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    ownerToken = login.body.accessToken as string;

    const suffix = Date.now().toString(36);
    policyId = (
      await prisma.cancellationPolicy.create({ data: { studioId: ZEN, name: `E2E loc ${suffix}`, freeCancelHours: 12, lateCancelChargeUnits: 1, noShowChargeUnits: 1 } })
    ).id;
    serviceTypeId = (
      await prisma.serviceType.create({ data: { studioId: ZEN, name: `E2E loc hizmet ${suffix}`, durationMin: 60, capacity: 2, cancellationPolicyId: policyId } })
    ).id;
    packageDefinitionId = (
      await prisma.packageDefinition.create({
        data: {
          studioId: ZEN,
          name: `E2E loc kredi ${suffix}`,
          entitlementKind: 'CREDIT',
          totalUnits: 6,
          validityDays: 30,
          price: 0,
          services: { create: { serviceTypeId, unitCost: 2 } },
        },
      })
    ).id;

    const members = await prisma.memberProfile.findMany({
      where: { studioId: ZEN, membership: { isPartnerGuest: false } },
      take: 2,
      orderBy: { id: 'asc' },
      include: { membership: { select: { userId: true, user: { select: { locale: true } } } } },
    });
    expect(members).toHaveLength(2);
    [englishMemberId, turkishMemberId] = members.map((m) => m.id);
    [englishUserId, turkishUserId] = members.map((m) => m.membership.userId);
    [previousEnglishLocale, previousTurkishLocale] = members.map((m) => m.membership.user.locale);
    // The first member reads English, the second follows the business default (Turkish in the seed).
    await prisma.user.update({ where: { id: englishUserId }, data: { locale: 'en' } });
    await prisma.user.update({ where: { id: turkishUserId }, data: { locale: null } });
    for (const userId of [englishUserId, turkishUserId]) {
      const token = `ExponentPushToken[e2e-locale-${userId.slice(0, 8)}-${suffix}]`;
      deviceTokens.push(token);
      await prisma.pushDevice.create({ data: { userId, token, platform: 'ios', deviceName: 'locale e2e' } });
    }
  });

  afterAll(async () => {
    await prisma.notificationLog.deleteMany({ where: { userId: { in: [englishUserId, turkishUserId] }, type: 'BOOKING_CHANGE', createdAt: { gte: new Date(Date.now() - 600_000) } } });
    await prisma.pushDevice.deleteMany({ where: { token: { in: deviceTokens } } });
    await prisma.user.update({ where: { id: englishUserId }, data: { locale: previousEnglishLocale } });
    await prisma.user.update({ where: { id: turkishUserId }, data: { locale: previousTurkishLocale } });
    await prisma.waitlist.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.bookingResource.deleteMany({ where: { booking: { scheduleId: { in: scheduleIds } } } });
    await prisma.booking.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: scheduleIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.memberPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.packageDefinition.deleteMany({ where: { id: packageDefinitionId } });
    await prisma.serviceType.deleteMany({ where: { id: serviceTypeId } });
    await prisma.cancellationPolicy.deleteMany({ where: { id: policyId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('writes a notification in the recipient language, whatever language the staff member asked in', async () => {
    const scheduleId = await makeSchedule(60, 2);
    expect((await book(englishMemberId, scheduleId, await makePackage(englishMemberId))).status).toBe(201);
    expect((await book(turkishMemberId, scheduleId, await makePackage(turkishMemberId))).status).toBe(201);

    // The owner works in Turkish; each recipient still gets their own language.
    const res = await as(ownerToken).post(`/schedules/${scheduleId}/cancel-session`).set('Accept-Language', 'tr').send({ reason: 'Hoca hasta', notifyMembers: true });
    expect(res.status).toBe(201);
    expect(res.body.membersNotified).toBe(2);

    const logs = await prisma.notificationLog.findMany({
      where: { userId: { in: [englishUserId, turkishUserId] }, type: 'BOOKING_CHANGE', createdAt: { gte: new Date(Date.now() - 120_000) } },
    });
    const english = logs.find((l) => l.userId === englishUserId);
    const turkish = logs.find((l) => l.userId === turkishUserId);
    expect(english?.subject).toBe('Session cancelled');
    expect(english?.content).toContain('was cancelled by the business. Reason: Hoca hasta');
    // The engine's own language chain lands on the same locale as the text.
    expect(english?.locale).toBe('en');
    expect(turkish?.subject).toBe('Seans iptal edildi');
    expect(turkish?.content).toContain('seansı işletme tarafından iptal edildi. Neden: Hoca hasta');
    expect(turkish?.locale).toBe('tr');
  });

  it('answers a cancellation in the requester language and names the message key', async () => {
    const scheduleId = await makeSchedule(2, 2);
    const booked = await book(turkishMemberId, scheduleId, await makePackage(turkishMemberId));
    expect(booked.status).toBe(201);
    const res = await as(ownerToken).post('/schedules/cancel').set('Accept-Language', 'en-US,en;q=0.9').send({ bookingId: booked.body.id, cancelledBy: 'MEMBER' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Because the session is less than 12 hours away, 1 unit(s) were deducted as a late cancellation and 1 unit(s) were returned.');
    expect(res.body.messageKey).toBe('apiTexts.cancel.lateCharged.hoursRefunded');
    expect(res.body.messageParams).toEqual({ hours: 12, penalty: 1, refund: 1 });
  });

  it('keeps Turkish when the request names no language', async () => {
    const scheduleId = await makeSchedule(3, 2);
    const booked = await book(turkishMemberId, scheduleId, await makePackage(turkishMemberId));
    expect(booked.status).toBe(201);
    const res = await as(ownerToken).post('/schedules/cancel').send({ bookingId: booked.body.id, cancelledBy: 'MEMBER' });
    expect(res.body.message).toContain('Seansa 12 saatten az kaldığı için');
  });

  it('sends the key of a field message next to its Turkish text', async () => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: 'someone@example.test', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: 'password', message: 'Şifre en az 6 karakter olmalıdır', messageKey: 'validation.passwordLeast6Characters' }]);
  });
});
