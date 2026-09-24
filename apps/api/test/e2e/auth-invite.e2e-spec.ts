process.env.OTP_TEST_CODE ??= '482915';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { normalizePhone } from '@platform/shared';
import { AppModule } from '../../src/app.module';

/**
 * End-to-end coverage for authentication (OTP login, PIN login/lockout) and
 * the invite flow, ported 1:1 from the reference Python script.
 *
 * OTP rate limits are per phone AND per IP; supertest requests all come
 * from the same IP, and the limit (10 per IP / 15 min) is shared with any
 * other e2e file run in the same window. This file only makes 4 OTP
 * requests (well under the 6 budget) and deletes every otp_challenges row
 * it creates in afterAll so repeated runs never accumulate toward the
 * limit.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OTP_TEST_CODE = process.env.OTP_TEST_CODE;

describe('Auth + Invites e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let ownerToken: string;

  // Unique, never-before-used phone numbers for this run so the suite can
  // be run repeatedly against the same database.
  const runId = Date.now().toString().slice(-7);
  const inviteeLocalPhone = `0533${runId}`;
  const unknownLocalPhone = `0534${runId}`;
  const inviteePhone = normalizePhone(inviteeLocalPhone)!;
  const unknownPhone = normalizePhone(unknownLocalPhone)!;

  const phonesToClean = [inviteePhone, unknownPhone];

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
    ZEN = zen.id;

    const loginRes = await request(server)
      .post('/auth/login')
      .send({ emailOrPhone: '05321000002', password: DEMO_PASSWORD });
    expect(loginRes.status).toBe(200);
    ownerToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    // Clean up in FK-safe order: challenges/logs/invites first (no
    // dependents), then the user (cascades membership/profile/consents).
    await prisma.otpChallenge.deleteMany({ where: { phone: { in: phonesToClean } } });
    await prisma.notificationLog.deleteMany({ where: { recipientPhone: { in: phonesToClean } } });
    await prisma.inviteToken.deleteMany({ where: { phone: { in: phonesToClean } } });
    const invitee = await prisma.user.findUnique({ where: { phone: inviteePhone } });
    if (invitee) {
      await prisma.auditLog.deleteMany({ where: { userId: invitee.id } });
      await prisma.user.delete({ where: { id: invitee.id } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('invite flow', () => {
    let token: string;
    let documentIds: string[];

    it('owner creates a member invite', async () => {
      const res = await request(server)
        .post('/invites')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, fullName: 'Deniz Kaya', phone: inviteeLocalPhone, roleKey: 'member', channel: 'SHOWN' });

      expect([200, 201]).toContain(res.status);
      expect(res.body.inviteUrl).toContain('/j/');
      expect(res.body.expiresAt).toBeDefined();
      token = res.body.token;
    });

    it('owner role can never be invited', async () => {
      const res = await request(server)
        .post('/invites')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-studio-id', ZEN)
        .send({ studioId: ZEN, fullName: 'X Y', phone: inviteeLocalPhone, roleKey: 'owner' });
      expect(res.status).toBe(403);
    });

    it('preview shows masked phone and required documents', async () => {
      const res = await request(server).get(`/invites/${token}`);
      expect(res.status).toBe(200);
      expect(res.body.phoneMasked).not.toBe(inviteePhone);
      const types = res.body.documents.map((d: any) => d.type);
      expect(types).toEqual(expect.arrayContaining(['KVKK_NOTICE', 'MEMBERSHIP_CONTRACT']));
      documentIds = res.body.documents.map((d: any) => d.id);
    });

    it('requesting the invite OTP succeeds', async () => {
      const res = await request(server).post(`/invites/${token}/otp`);
      expect(res.status).toBe(202);
    });

    it('a second immediate OTP request is rate-limited (cooldown)', async () => {
      const res = await request(server).post(`/invites/${token}/otp`);
      expect(res.status).toBe(429);
    });

    it('accept with the wrong code -> 401', async () => {
      const res = await request(server)
        .post(`/invites/${token}/accept`)
        .send({ code: '111111', pin: '482916', acceptedDocumentVersionIds: documentIds });
      expect(res.status).toBe(401);
    });

    it('accept with missing consent -> 400', async () => {
      const res = await request(server)
        .post(`/invites/${token}/accept`)
        .send({ code: OTP_TEST_CODE, pin: '482916', acceptedDocumentVersionIds: [documentIds[0]] });
      expect(res.status).toBe(400);
    });

    it('accept with a weak PIN -> 400', async () => {
      const res = await request(server)
        .post(`/invites/${token}/accept`)
        .send({ code: OTP_TEST_CODE, pin: '123456', acceptedDocumentVersionIds: documentIds });
      expect(res.status).toBe(400);
    });

    it('accept succeeds and returns a member membership', async () => {
      const res = await request(server)
        .post(`/invites/${token}/accept`)
        .send({ code: OTP_TEST_CODE, pin: '482916', acceptedDocumentVersionIds: documentIds, device: 'e2e' });
      expect(res.status).toBe(200);
      const memberships = res.body.user.memberships.map((m: any) => [m.studioSlug, m.roleKey]);
      expect(memberships).toContainEqual(['zen-reformer-pilates', 'member']);
    });

    it('reusing the already-consumed invite -> 404 (findUsable rejects a used token)', async () => {
      const res = await request(server)
        .post(`/invites/${token}/accept`)
        .send({ code: OTP_TEST_CODE, pin: '482916', acceptedDocumentVersionIds: documentIds });
      expect(res.status).toBe(404);
    });

    it('the new member can PIN login', async () => {
      const res = await request(server).post('/auth/pin/login').send({ phone: inviteeLocalPhone, pin: '482916' });
      expect(res.status).toBe(200);
    });

    it('a consent row was recorded for every required document', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { phone: inviteePhone } });
      const count = await prisma.consent.count({
        where: { membership: { userId: user.id, studioId: ZEN } },
      });
      expect(count).toBe(documentIds.length);
    });

    it('the stored SMS content is redacted, not the real code/link', async () => {
      const logs = await prisma.notificationLog.findMany({ where: { recipientPhone: inviteePhone } });
      expect(logs.length).toBeGreaterThan(0);
      for (const log of logs) {
        expect(log.content).toBe('[gizli icerik]');
      }
    });
  });

  describe('login OTP and PIN lockout', () => {
    it('requesting a login OTP for an unknown phone answers the same generic message and sends no SMS', async () => {
      const res = await request(server).post('/auth/otp/request').send({ phone: unknownLocalPhone });
      expect(res.status).toBe(202);
      expect(res.body.message).toBe('Numara kayıtlıysa doğrulama kodu gönderildi');

      const logs = await prisma.notificationLog.findMany({ where: { recipientPhone: unknownPhone } });
      expect(logs.length).toBe(0);
    });

    it('requesting a login OTP for the known (newly invited) phone answers the same message', async () => {
      const res = await request(server).post('/auth/otp/request').send({ phone: inviteeLocalPhone });
      expect(res.status).toBe(202);
      expect(res.body.message).toBe('Numara kayıtlıysa doğrulama kodu gönderildi');
    });

    it('verifying the login OTP with the test code succeeds', async () => {
      const res = await request(server)
        .post('/auth/otp/verify')
        .send({ phone: inviteeLocalPhone, code: OTP_TEST_CODE });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
    });

    it('locks the account after 5 wrong PIN attempts, and a 6th (even correct) attempt stays locked', async () => {
      let lastStatus = 0;
      for (let i = 0; i < 6; i += 1) {
        const res = await request(server).post('/auth/pin/login').send({ phone: inviteeLocalPhone, pin: '999111' });
        lastStatus = res.status;
      }
      expect(lastStatus).toBe(403);

      const correctAfterLock = await request(server)
        .post('/auth/pin/login')
        .send({ phone: inviteeLocalPhone, pin: '482916' });
      expect(correctAfterLock.status).toBe(403);
    });
  });
});
