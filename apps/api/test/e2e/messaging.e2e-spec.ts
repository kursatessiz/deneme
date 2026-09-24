import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';

/**
 * W7: messaging. Tenant channel settings, SMS wallet, İYS-style commercial
 * consent self-service, and the send() fallback/credit-deduction behaviour.
 * Restores every row it changes so the suite can run repeatedly.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';
const SUPER_ADMIN_PHONE = '+905321000001';

describe('Messaging (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;
  let notifications: NotificationsService;

  let ZEN: string;
  let FLOW: string;
  let memberUserId: string;
  let ownerToken: string;
  let trainerToken: string;
  let memberToken: string;
  let superAdminToken: string;

  let originalSettings: unknown;
  let originalWalletBalance: number;

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    notifications = app.get(NotificationsService);

    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = zen.id;
    originalSettings = zen.notificationSettings;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;

    const member = await prisma.user.findUniqueOrThrow({ where: { phone: MEMBER_PHONE } });
    memberUserId = member.id;

    const wallet = await prisma.smsWallet.findUniqueOrThrow({ where: { studioId: ZEN } });
    originalWalletBalance = wallet.balance;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
    superAdminToken = await login(SUPER_ADMIN_PHONE);
  });

  afterAll(async () => {
    await prisma.studio.update({ where: { id: ZEN }, data: { notificationSettings: originalSettings as object } });
    await prisma.smsWallet.update({ where: { studioId: ZEN }, data: { balance: originalWalletBalance } });
    await prisma.communicationConsent.upsert({
      where: { studioId_userId_channel: { studioId: ZEN, userId: memberUserId, channel: 'SMS' } },
      create: { studioId: ZEN, userId: memberUserId, channel: 'SMS', status: 'GRANTED', source: 'seed', grantedAt: new Date() },
      update: { status: 'GRANTED', grantedAt: new Date(), revokedAt: null, iysSyncedAt: null },
    });
    await prisma.notificationLog.deleteMany({ where: { studioId: ZEN, type: 'BOOKING_REMINDER' } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('notification settings', () => {
    it('owner reads and updates the channel order', async () => {
      const get = await as(ownerToken, ZEN).get(`/studios/${ZEN}/notification-settings`);
      expect(get.status).toBe(200);
      expect(get.body.order).toEqual(['WHATSAPP', 'SMS']);

      const put = await as(ownerToken, ZEN)
        .put(`/studios/${ZEN}/notification-settings`)
        .send({ order: ['SMS'], whatsappEnabled: false, smsSenderName: 'ZENPLTS' });
      expect(put.status).toBe(200);
      expect(put.body).toEqual({ order: ['SMS'], whatsappEnabled: false, smsSenderName: 'ZENPLTS' });

      const getAfter = await as(ownerToken, ZEN).get(`/studios/${ZEN}/notification-settings`);
      expect(getAfter.body.whatsappEnabled).toBe(false);
    });

    it('rejects a duplicated or unknown channel', async () => {
      for (const body of [{ order: ['SMS', 'SMS'] }, { order: ['EMAIL'] }, { order: [] }]) {
        const res = await as(ownerToken, ZEN).put(`/studios/${ZEN}/notification-settings`).send(body);
        expect(res.status).toBe(400);
      }
    });

    it('trainer and member cannot read or change settings', async () => {
      for (const token of [trainerToken, memberToken]) {
        expect((await as(token, ZEN).get(`/studios/${ZEN}/notification-settings`)).status).toBe(403);
        expect((await as(token, ZEN).put(`/studios/${ZEN}/notification-settings`).send({ order: ['SMS'] })).status).toBe(403);
      }
    });

    it('owner cannot read another tenant settings', async () => {
      const res = await as(ownerToken, FLOW).get(`/studios/${FLOW}/notification-settings`);
      expect(res.status).toBe(403);
    });
  });

  describe('SMS wallet', () => {
    it('owner sees balance and transactions; staff without the permission cannot', async () => {
      const res = await as(ownerToken, ZEN).get(`/studios/${ZEN}/sms-wallet`);
      expect(res.status).toBe(200);
      expect(typeof res.body.balance).toBe('number');

      const txRes = await as(ownerToken, ZEN).get(`/studios/${ZEN}/sms-wallet/transactions`);
      expect(txRes.status).toBe(200);
      expect(Array.isArray(txRes.body.items)).toBe(true);

      for (const token of [trainerToken, memberToken]) {
        expect((await as(token, ZEN).get(`/studios/${ZEN}/sms-wallet`)).status).toBe(403);
      }
    });

    it('super admin can top up; a non-super-admin owner cannot', async () => {
      const before = await as(ownerToken, ZEN).get(`/studios/${ZEN}/sms-wallet`);

      const topUp = await request(server)
        .post('/sms-wallet/top-up')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ studioId: ZEN, credits: 50, note: 'e2e top-up' });
      expect(topUp.status).toBe(201);
      expect(topUp.body.wallet.balance).toBe(before.body.balance + 50);

      const denied = await request(server)
        .post('/sms-wallet/top-up')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ studioId: ZEN, credits: 10 });
      expect(denied.status).toBe(403);
    });

    it('does not charge the wallet when it is empty, and charges exactly one credit on a successful send', async () => {
      // Force the SMS-only path so send() cannot silently succeed via mock WhatsApp.
      await prisma.studio.update({ where: { id: ZEN }, data: { notificationSettings: { order: ['SMS'], whatsappEnabled: false } } });

      // BOOKING_CHANGE defaults to sms: true, unlike BOOKING_REMINDER, so the
      // demo member (no stored override) actually reaches the channel logic.
      await prisma.smsWallet.update({ where: { studioId: ZEN }, data: { balance: 0 } });
      const emptyResult = await notifications.send({
        studioId: ZEN,
        userId: memberUserId,
        category: 'BOOKING_CHANGE',
        template: 'BOOKING_REMINDER',
        params: { firstName: 'Test', serviceName: 'Reformer', startTime: '10:00' },
      });
      expect(emptyResult.success).toBe(false);
      expect((await prisma.smsWallet.findUniqueOrThrow({ where: { studioId: ZEN } })).balance).toBe(0);

      await prisma.smsWallet.update({ where: { studioId: ZEN }, data: { balance: 3 } });
      const okResult = await notifications.send({
        studioId: ZEN,
        userId: memberUserId,
        category: 'BOOKING_CHANGE',
        template: 'BOOKING_REMINDER',
        params: { firstName: 'Test', serviceName: 'Reformer', startTime: '10:00' },
      });
      expect(okResult).toMatchObject({ success: true, channel: 'SMS' });
      expect((await prisma.smsWallet.findUniqueOrThrow({ where: { studioId: ZEN } })).balance).toBe(2);

      const usage = await prisma.smsTransaction.findFirst({ where: { studioId: ZEN, type: 'USAGE' }, orderBy: { createdAt: 'desc' } });
      expect(usage).not.toBeNull();
      expect(usage!.amount).toBe(-1);
    });
  });

  describe('commercial consent self-service', () => {
    it('member reads and revokes/grants their own consent', async () => {
      const get = await as(memberToken, ZEN).get(`/studios/${ZEN}/notification-consents/self`);
      expect(get.status).toBe(200);
      const sms = get.body.items.find((i: any) => i.channel === 'SMS');
      expect(sms.status).toBe('GRANTED');

      const revoke = await as(memberToken, ZEN).put(`/studios/${ZEN}/notification-consents/self`).send({ channel: 'SMS', granted: false });
      expect(revoke.status).toBe(200);
      expect(revoke.body.items.find((i: any) => i.channel === 'SMS').status).toBe('REVOKED');

      const grant = await as(memberToken, ZEN).put(`/studios/${ZEN}/notification-consents/self`).send({ channel: 'SMS', granted: true });
      expect(grant.body.items.find((i: any) => i.channel === 'SMS').status).toBe('GRANTED');
    });

    it('rejects an unknown channel', async () => {
      const res = await as(memberToken, ZEN).put(`/studios/${ZEN}/notification-consents/self`).send({ channel: 'CARRIER_PIGEON', granted: true });
      expect(res.status).toBe(400);
    });

    it('staff with members.view can list every consent; a plain member cannot', async () => {
      const staffList = await as(trainerToken, ZEN).get(`/studios/${ZEN}/notification-consents`);
      expect(staffList.status).toBe(200);
      expect(Array.isArray(staffList.body.items)).toBe(true);

      const denied = await as(memberToken, ZEN).get(`/studios/${ZEN}/notification-consents`);
      expect(denied.status).toBe(403);
    });

    it('exports a CSV for staff', async () => {
      const res = await as(trainerToken, ZEN).get(`/studios/${ZEN}/notification-consents/export`);
      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('text/csv');
      expect(res.text.split('\n')[0]).toContain('Kanal');
    });
  });
});
