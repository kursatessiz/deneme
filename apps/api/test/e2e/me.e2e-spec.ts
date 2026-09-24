import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * "Hesabım" endpoints: notification preferences and push device
 * registration. Uses seeded demo users; cleans up what it creates.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const MEMBER_PHONE = '+905321000016';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';

describe('Me (account settings) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;
  let memberToken: string;
  let ownerToken: string;
  let trainerToken: string;
  const suffix = Date.now().toString(36);
  const deviceToken = `ExponentPushToken[e2eMember${suffix}]`;
  let memberUserId: string;

  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    memberToken = await login(MEMBER_PHONE);
    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberUserId = (await prisma.user.findUniqueOrThrow({ where: { phone: MEMBER_PHONE } })).id;
  });

  afterAll(async () => {
    await prisma.pushDevice.deleteMany({ where: { token: deviceToken } });
    await prisma.notificationPreference.deleteMany({ where: { userId: memberUserId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('requires authentication', async () => {
    expect((await request(server).get('/me/notification-preferences')).status).toBe(401);
  });

  it('returns defaults with marketing off and hides trainer-only categories from members', async () => {
    const res = await request(server).get('/me/notification-preferences').set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    const byCategory = Object.fromEntries(res.body.items.map((i: { category: string }) => [i.category, i]));
    expect(byCategory.MARKETING).toMatchObject({ push: false, sms: false, marketing: true });
    expect(byCategory.BOOKING_REMINDER).toMatchObject({ push: true });
    expect(byCategory.TRAINER_SCHEDULE).toBeUndefined();
  });

  it('shows trainer-only categories to trainers', async () => {
    const res = await request(server).get('/me/notification-preferences').set('Authorization', `Bearer ${trainerToken}`);
    expect(res.body.items.map((i: { category: string }) => i.category)).toContain('TRAINER_SCHEDULE');
  });

  it('updates a subset and keeps the rest', async () => {
    const res = await request(server)
      .put('/me/notification-preferences')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ preferences: { BOOKING_REMINDER: { push: false, sms: true } } });
    expect(res.status).toBe(200);
    const reminder = res.body.items.find((i: { category: string }) => i.category === 'BOOKING_REMINDER');
    expect(reminder).toMatchObject({ push: false, sms: true });
    const waitlist = res.body.items.find((i: { category: string }) => i.category === 'WAITLIST');
    expect(waitlist).toMatchObject({ push: true, sms: true });
  });

  it('rejects unknown categories', async () => {
    const res = await request(server)
      .put('/me/notification-preferences')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ preferences: { LOGIN_OTP: { push: false, sms: false } } });
    expect(res.status).toBe(400);
  });

  it('registers an Expo push token and rejects anything else', async () => {
    const ok = await request(server)
      .post('/me/push-devices')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token: deviceToken, platform: 'ios', deviceName: 'e2e' });
    expect(ok.status).toBe(204);

    const bad = await request(server)
      .post('/me/push-devices')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token: 'https://attacker.example/hook', platform: 'ios' });
    expect(bad.status).toBe(400);

    const stored = await prisma.pushDevice.findUniqueOrThrow({ where: { token: deviceToken } });
    expect(stored.userId).toBe(memberUserId);
  });

  it('does not let another user delete the device', async () => {
    const res = await request(server)
      .delete(`/me/push-devices/${encodeURIComponent(deviceToken)}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(204);
    expect(await prisma.pushDevice.findUnique({ where: { token: deviceToken } })).not.toBeNull();
  });

  it('lets the owner of the device remove it', async () => {
    const res = await request(server)
      .delete(`/me/push-devices/${encodeURIComponent(deviceToken)}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(204);
    expect(await prisma.pushDevice.findUnique({ where: { token: deviceToken } })).toBeNull();
  });
});
