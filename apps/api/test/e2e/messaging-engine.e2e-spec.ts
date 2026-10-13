import { createSign, generateKeyPairSync } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { getExpectedTwilioSignature } from 'twilio/lib/webhooks/webhooks';
import { AppModule } from '../../src/app.module';
import { configureBodyParsers } from '../../src/common/body-parsers';
import { MessagingService } from '../../src/modules/messaging/engine/messaging.service';
import { MessagingUrls } from '../../src/modules/messaging/tracking/messaging-urls.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SNS_CERT_FETCHER, snsStringToSign } from '../../src/modules/messaging/webhooks/sns-verifier';
import type { SnsEnvelope } from '../../src/modules/messaging/webhooks/sns-verifier';
import { signMetaBody } from '../../src/modules/messaging/webhooks/whatsapp-signature';

/**
 * G1c messaging engine end to end, with the production body parsers:
 * transactional vs commercial sends (consent, quiet hours, frequency cap,
 * idempotency), email tracking (open, click, no open redirect),
 * unsubscribe (page info + one-click, idempotent, consent revoked),
 * suppression after an SNS-signed SES bounce, inbound WhatsApp/Twilio
 * creating contacts and conversations, STOP/HELP keywords, the inbox
 * (permissions, tenant isolation, WhatsApp 24h rule, assign/close, saved
 * replies), member in-app chat and the tenant template/settings endpoints.
 *
 * Every row it creates uses the +90539888 phone prefix or the
 * e2e-g1c.example email domain, or is restored in afterAll, so the suite
 * passes twice in a row on the same database.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const RECEPTION_PHONE = '+905321000003';
const TRAINER_PHONE = '+905321000004';
const MEMBER_PHONE = '+905321000016';
const FLOW_OWNER_PHONE = '+905321000022';
const SUPER_ADMIN_PHONE = '+905321000001';
const PREFIX = '+90539888';
const EMAIL_DOMAIN = 'e2e-g1c.example';
const WA_SECRET = 'e2e-whatsapp-app-secret';
const WA_VERIFY = 'e2e-verify-token-0123456789';
const TWILIO_TOKEN = 'e2e-twilio-auth-token';
const WA_NUMBER_ID = '5550001112223';
const SMS_NUMBER = '+15005550006';
const PUBLIC_API = 'http://localhost:4000';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SNS_CERT_URL = 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-e2e.pem';

function phone(n: number): string {
  return `${PREFIX}${String(n).padStart(4, '0')}`;
}

/** An IANA zone where it is currently around noon, so commercial sends are inside quiet hours whenever the suite runs. */
function daytimeZone(): string {
  const offset = 12 - new Date().getUTCHours(); // -11 .. +12
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** An IANA zone where it is currently around 03:00. */
function nightZone(): string {
  let offset = 3 - new Date().getUTCHours();
  if (offset < -12) offset += 24;
  if (offset > 14) offset -= 24;
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

function signSns(fields: Omit<SnsEnvelope, 'Signature' | 'SignatureVersion' | 'SigningCertURL'>): SnsEnvelope {
  const unsigned: SnsEnvelope = { ...fields, SignatureVersion: '2', SigningCertURL: SNS_CERT_URL, Signature: '' };
  const Signature = createSign('RSA-SHA256').update(snsStringToSign(unsigned)!, 'utf8').sign(privateKey, 'base64');
  return { ...unsigned, Signature };
}

describe('Messaging engine G1c (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let server: Parameters<typeof request>[0];
  let messaging: MessagingService;
  let urls: MessagingUrls;

  let ZEN: string;
  let FLOW: string;
  let ownerToken: string;
  let receptionToken: string;
  let trainerToken: string;
  let memberToken: string;
  let flowOwnerToken: string;
  let superAdminToken: string;
  let ownerMembershipId: string;
  let memberContactId: string;

  let originalMessagingSettings: unknown;
  let originalWallet: number;
  const envBackup: Record<string, string | undefined> = {};

  // Commercial-email recipient: a member with EMAIL consent in a daytime zone.
  let buyerUserId: string;
  let buyerContactId: string;
  const buyerEmail = `buyer@${EMAIL_DOMAIN}`;

  const login = async (p: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: p, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });

  async function cleanup() {
    const contacts = await prisma.contact.findMany({
      where: { OR: [{ phone: { startsWith: PREFIX } }, { email: { endsWith: `@${EMAIL_DOMAIN}` } }] },
      select: { id: true },
    });
    const ids = contacts.map((c) => c.id);
    await prisma.notificationLog.deleteMany({
      where: {
        OR: [
          { contactId: { in: ids } },
          { recipientPhone: { startsWith: PREFIX } },
          { recipientEmail: { endsWith: `@${EMAIL_DOMAIN}` } },
          { type: { startsWith: 'E2E_' } },
        ],
      },
    });
    await prisma.messageSuppression.deleteMany({
      where: { OR: [{ address: { startsWith: PREFIX } }, { address: { endsWith: `@${EMAIL_DOMAIN}` } }] },
    });
    await prisma.conversation.deleteMany({ where: { contactId: { in: ids } } });
    await prisma.contact.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: PREFIX } } });
    await prisma.messageTemplate.deleteMany({ where: { key: { startsWith: 'E2E_' } } });
    await prisma.savedReply.deleteMany({ where: { title: { startsWith: 'E2E ' } } });
  }

  beforeAll(async () => {
    for (const [k, v] of Object.entries({
      WHATSAPP_APP_SECRET: WA_SECRET,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: WA_VERIFY,
      TWILIO_AUTH_TOKEN: TWILIO_TOKEN,
      SMS_DLR_WEBHOOK_TOKEN: 'e2e-dlr-token-0123456789abcdef',
      SES_SNS_TOPIC_ARNS: 'arn:aws:sns:eu-central-1:123456789012:ses',
    })) {
      envBackup[k] = process.env[k];
      process.env[k] = v;
    }

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SNS_CERT_FETCHER)
      .useValue(async (url: string) => {
        if (url !== SNS_CERT_URL) throw new Error('unexpected certificate url');
        return publicKey.export({ type: 'spki', format: 'pem' }).toString();
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureBodyParsers(app);
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    messaging = app.get(MessagingService);
    urls = app.get(MessagingUrls);

    const zen = await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } });
    ZEN = zen.id;
    originalMessagingSettings = zen.messagingSettings;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    originalWallet = (await prisma.smsWallet.findUniqueOrThrow({ where: { studioId: ZEN } })).balance;

    await cleanup();

    ownerToken = await login(OWNER_PHONE);
    receptionToken = await login(RECEPTION_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    memberToken = await login(MEMBER_PHONE);
    flowOwnerToken = await login(FLOW_OWNER_PHONE);
    superAdminToken = await login(SUPER_ADMIN_PHONE);

    ownerMembershipId = (await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: OWNER_PHONE } } })).id;
    const memberMembership = await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: MEMBER_PHONE } } });
    memberContactId = (await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, membershipId: memberMembership.id } })).id;

    const memberRole = await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'member' } });
    const buyer = await prisma.user.create({ data: { phone: phone(1), firstName: 'Buyer', lastName: 'E2E', locale: 'en' } });
    buyerUserId = buyer.id;
    const buyerMembership = await prisma.membership.create({
      data: { userId: buyer.id, studioId: ZEN, roleTemplateId: memberRole.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    await prisma.memberProfile.create({ data: { membershipId: buyerMembership.id, studioId: ZEN } });
    const buyerContact = await prisma.contact.create({
      data: {
        studioId: ZEN,
        firstName: 'Buyer',
        lastName: 'E2E',
        phone: phone(1),
        email: buyerEmail,
        locale: 'en',
        timezone: daytimeZone(),
        lifecycleStage: 'MEMBER',
        membershipId: buyerMembership.id,
        isTest: true,
      },
    });
    buyerContactId = buyerContact.id;
    await prisma.communicationConsent.create({
      data: { studioId: ZEN, userId: buyer.id, channel: 'EMAIL', status: 'GRANTED', source: 'e2e', grantedAt: new Date() },
    });

    // A tenant template with a link, for click tracking.
    const tpl = await as(ownerToken, ZEN)
      .put(`/studios/${ZEN}/messaging/templates`)
      .send({
        key: 'E2E_PROMO',
        channel: 'EMAIL',
        locale: 'en',
        subject: 'Spring offer for {firstName}',
        body: 'Hi {firstName}, we have a spring offer.',
        blocks: [
          { type: 'heading', text: 'Spring offer for {firstName}' },
          { type: 'paragraph', text: 'Hi {firstName}, we have a spring offer.' },
          { type: 'button', label: 'See the offer', url: 'https://example.com/offer?utm_source=email' },
        ],
        isTransactional: false,
      });
    expect(tpl.status).toBe(200);
    expect(tpl.body).toMatchObject({ source: 'TENANT', key: 'E2E_PROMO', isTransactional: false });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.conversation.deleteMany({ where: { contactId: memberContactId } });
    await prisma.studio.update({ where: { id: ZEN }, data: { messagingSettings: originalMessagingSettings as object } });
    await prisma.smsWallet.update({ where: { studioId: ZEN }, data: { balance: originalWallet } });
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------

  describe('send paths', () => {
    it('sends a transactional email with no unsubscribe footer and no open pixel', async () => {
      const result = await messaging.send({
        studioId: ZEN,
        recipient: { contactId: buyerContactId },
        channel: 'EMAIL',
        templateKey: 'BOOKING_REMINDER',
        variables: { serviceName: 'Reformer', startTime: '10:00' },
      });
      expect(result).toMatchObject({ success: true, channel: 'EMAIL' });
      const log = await prisma.notificationLog.findUniqueOrThrow({ where: { id: result.notificationLogId! } });
      expect(log).toMatchObject({ purpose: 'TRANSACTIONAL', status: 'SENT', locale: 'en', recipientEmail: buyerEmail, provider: 'MOCK' });
      expect(log.subject).toBe('Session reminder');
      expect(log.content).toContain('Hi Buyer, your Reformer session starts at 10:00.');
      expect(log.content).not.toContain('/m/u/');
    });

    it('sends a commercial email with consent: tracked links, unsubscribe link, frequency counted', async () => {
      const result = await messaging.send({ studioId: ZEN, recipient: { contactId: buyerContactId }, channel: 'EMAIL', templateKey: 'E2E_PROMO' });
      expect(result).toMatchObject({ success: true, channel: 'EMAIL' });
      const log = await prisma.notificationLog.findUniqueOrThrow({ where: { id: result.notificationLogId! }, include: { links: true } });
      expect(log.purpose).toBe('COMMERCIAL');
      expect(log.content).toContain('/m/u/');
      expect(log.links).toHaveLength(1);
      expect(log.links[0].url).toBe('https://example.com/offer?utm_source=email');
    });

    it('refuses a commercial message without consent', async () => {
      const result = await messaging.send({ studioId: ZEN, recipient: { contactId: memberContactId }, channel: 'EMAIL', templateKey: 'E2E_PROMO' });
      expect(result.success).toBe(false);
      expect(['CONSENT_REQUIRED', 'NO_ADDRESS', 'NO_TEMPLATE']).toContain(result.reasonCode);
    });

    it('holds commercial messages in the recipient\'s quiet hours, but never transactional ones', async () => {
      await prisma.contact.update({ where: { id: buyerContactId }, data: { timezone: nightZone() } });
      try {
        const commercial = await messaging.send({ studioId: ZEN, recipient: { contactId: buyerContactId }, channel: 'EMAIL', templateKey: 'E2E_PROMO' });
        expect(commercial).toMatchObject({ success: false, reasonCode: 'QUIET_HOURS' });
        const transactional = await messaging.send({
          studioId: ZEN,
          recipient: { contactId: buyerContactId },
          channel: 'EMAIL',
          templateKey: 'BOOKING_REMINDER',
          variables: { serviceName: 'Reformer', startTime: '10:00' },
        });
        expect(transactional.success).toBe(true);
      } finally {
        await prisma.contact.update({ where: { id: buyerContactId }, data: { timezone: daytimeZone() } });
      }
    });

    it('applies the tenant frequency cap per contact', async () => {
      const put = await as(ownerToken, ZEN).put(`/studios/${ZEN}/messaging/settings`).send({ frequencyCap: { perDay: 1, perWeek: 5 } });
      expect(put.status).toBe(200);
      expect(put.body.frequencyCap).toEqual({ perDay: 1, perWeek: 5 });
      // The commercial email above already counts for today.
      const capped = await messaging.send({ studioId: ZEN, recipient: { contactId: buyerContactId }, channel: 'EMAIL', templateKey: 'E2E_PROMO' });
      expect(capped).toMatchObject({ success: false, reasonCode: 'FREQUENCY_CAP' });
      await as(ownerToken, ZEN).put(`/studios/${ZEN}/messaging/settings`).send({ frequencyCap: { perDay: 3, perWeek: 10 } });
    });

    it('sends once per idempotency key', async () => {
      const input = {
        studioId: ZEN,
        recipient: { contactId: buyerContactId },
        channel: 'EMAIL' as const,
        templateKey: 'BOOKING_REMINDER',
        variables: { serviceName: 'Mat', startTime: '11:00' },
        idempotencyKey: `e2e-${buyerContactId}-reminder`,
      };
      const first = await messaging.send(input);
      const second = await messaging.send(input);
      expect(first.success).toBe(true);
      expect(second).toMatchObject({ success: true, duplicate: true, notificationLogId: first.notificationLogId });
      expect(await prisma.notificationLog.count({ where: { studioId: ZEN, idempotencyKey: input.idempotencyKey } })).toBe(1);
    });

    it('keeps the legacy NotificationsService path for Turkish tenants unchanged', async () => {
      const notifications = app.get(NotificationsService);
      const result = await notifications.sendSms({ studioId: null, phone: phone(90), message: 'Kod: 123456', type: 'LOGIN_OTP', sensitive: true });
      expect(result.success).toBe(true);
      const log = await prisma.notificationLog.findFirstOrThrow({ where: { recipientPhone: phone(90) } });
      expect(log).toMatchObject({ channel: 'SMS', content: '[gizli icerik]', status: 'SENT', purpose: 'TRANSACTIONAL' });
    });
  });

  describe('tracking', () => {
    let commercialLogId: string;
    let linkId: string;

    beforeAll(async () => {
      const log = await prisma.notificationLog.findFirstOrThrow({
        where: { contactId: buyerContactId, purpose: 'COMMERCIAL', channel: 'EMAIL', status: 'SENT' },
        include: { links: true },
        orderBy: { createdAt: 'asc' },
      });
      commercialLogId = log.id;
      linkId = log.links[0].id;
    });

    it('records human and machine (Apple MPP) opens separately', async () => {
      const token = urls.sign('o', commercialLogId)!;
      const machine = await request(server).get(`/m/o/${token}`).set('User-Agent', 'Mozilla/5.0');
      expect(machine.status).toBe(200);
      expect(machine.header['content-type']).toContain('image/gif');
      let log = await prisma.notificationLog.findUniqueOrThrow({ where: { id: commercialLogId } });
      expect(log.machineOpenedAt).not.toBeNull();
      expect(log.openedAt).toBeNull();

      await request(server).get(`/m/o/${token}`).set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36');
      log = await prisma.notificationLog.findUniqueOrThrow({ where: { id: commercialLogId } });
      expect(log.openedAt).not.toBeNull();

      // A bad token still gets the pixel and records nothing.
      expect((await request(server).get('/m/o/garbage')).status).toBe(200);
    });

    it('resolves a click only to the stored target and never to a URL from the request', async () => {
      const token = urls.sign('c', linkId)!;
      const res = await request(server)
        .post(`/m/c/${token}`)
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36')
        .send({ url: 'https://evil.example.com' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ url: 'https://example.com/offer?utm_source=email' });
      const log = await prisma.notificationLog.findUniqueOrThrow({ where: { id: commercialLogId } });
      expect(log.clickedAt).not.toBeNull();

      expect((await request(server).post(`/m/c/${token.slice(0, -3)}abc`)).status).toBe(404);
      const redirect = await request(server).get('/m/c/garbage?url=https://evil.example.com');
      expect(redirect.status).toBe(302);
      expect(redirect.header.location).not.toContain('evil');
      const direct = await request(server).get(`/m/c/${token}`);
      expect(direct.status).toBe(302);
      expect(direct.header.location).toBe('https://example.com/offer?utm_source=email');
    });
  });

  describe('unsubscribe', () => {
    it('shows the page info, unsubscribes once (idempotent), revokes consent and blocks commercial sends', async () => {
      const log = await prisma.notificationLog.findFirstOrThrow({ where: { contactId: buyerContactId, purpose: 'COMMERCIAL', status: 'SENT' } });
      const token = urls.sign('u', log.id)!;

      const info = await request(server).get(`/m/u/${token}`);
      expect(info.status).toBe(200);
      expect(info.body).toEqual({ studioName: expect.any(String), channel: 'EMAIL', maskedAddress: 'b***@e2e-g1c.example', alreadyUnsubscribed: false });
      expect(JSON.stringify(info.body)).not.toContain(buyerEmail);

      const first = await request(server).post(`/m/u/${token}`).type('form').send('List-Unsubscribe=One-Click');
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ unsubscribed: true, alreadyUnsubscribed: false });
      const again = await request(server).post(`/m/u/${token}`);
      expect(again.body).toEqual({ unsubscribed: true, alreadyUnsubscribed: true });
      expect((await request(server).get(`/m/u/${token}`)).body.alreadyUnsubscribed).toBe(true);
      expect((await request(server).post('/m/u/not-a-token')).status).toBe(404);

      const consent = await prisma.communicationConsent.findUniqueOrThrow({
        where: { studioId_userId_channel: { studioId: ZEN, userId: buyerUserId, channel: 'EMAIL' } },
      });
      expect(consent.status).toBe('REVOKED');
      expect(await prisma.messageSuppression.count({ where: { studioId: ZEN, channel: 'EMAIL', address: buyerEmail, reason: 'UNSUBSCRIBED' } })).toBe(1);

      const blocked = await messaging.send({ studioId: ZEN, recipient: { contactId: buyerContactId }, channel: 'EMAIL', templateKey: 'E2E_PROMO' });
      expect(blocked).toMatchObject({ success: false, reasonCode: 'OPTED_OUT' });
      const transactional = await messaging.send({
        studioId: ZEN,
        recipient: { contactId: buyerContactId },
        channel: 'EMAIL',
        templateKey: 'BOOKING_REMINDER',
        variables: { serviceName: 'x', startTime: 'y' },
      });
      expect(transactional.success).toBe(true);
    });
  });

  describe('SES bounce via SNS', () => {
    let bouncedContactId: string;
    const bouncedEmail = `bounce@${EMAIL_DOMAIN}`;

    beforeAll(async () => {
      const user = await prisma.user.create({ data: { phone: phone(2), firstName: 'Bounce', lastName: 'E2E' } });
      const memberRole = await prisma.roleTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'member' } });
      const membership = await prisma.membership.create({ data: { userId: user.id, studioId: ZEN, roleTemplateId: memberRole.id, status: 'ACTIVE' } });
      const contact = await prisma.contact.create({
        data: { studioId: ZEN, firstName: 'Bounce', phone: phone(2), email: bouncedEmail, locale: 'en', timezone: daytimeZone(), membershipId: membership.id, isTest: true },
      });
      bouncedContactId = contact.id;
      await prisma.communicationConsent.create({
        data: { studioId: ZEN, userId: user.id, channel: 'EMAIL', status: 'GRANTED', source: 'e2e', grantedAt: new Date() },
      });
    });

    it('rejects an unsigned or wrongly signed SNS message', async () => {
      const envelope = signSns({
        Type: 'Notification',
        MessageId: 'sns-bad',
        TopicArn: 'arn:aws:sns:eu-central-1:123456789012:ses',
        Message: JSON.stringify({ eventType: 'Bounce', mail: { messageId: 'x' } }),
        Timestamp: new Date().toISOString(),
      });
      const tampered = { ...envelope, Message: envelope.Message.replace('Bounce', 'Delivery') };
      const res = await request(server).post('/messaging/webhook/ses').set('Content-Type', 'text/plain; charset=UTF-8').send(JSON.stringify(tampered));
      expect(res.status).toBe(403);
      expect((await request(server).post('/messaging/webhook/ses').set('Content-Type', 'text/plain').send('{}')).status).toBe(400);
    });

    it('a permanent bounce marks the log and suppresses future commercial email to the address', async () => {
      const sent = await messaging.send({ studioId: ZEN, recipient: { contactId: bouncedContactId }, channel: 'EMAIL', templateKey: 'E2E_PROMO' });
      expect(sent.success).toBe(true);
      const log = await prisma.notificationLog.findUniqueOrThrow({ where: { id: sent.notificationLogId! } });

      const envelope = signSns({
        Type: 'Notification',
        MessageId: 'sns-1',
        TopicArn: 'arn:aws:sns:eu-central-1:123456789012:ses',
        Message: JSON.stringify({
          eventType: 'Bounce',
          mail: { messageId: log.providerMessageId },
          bounce: { bounceType: 'Permanent', bounceSubType: 'General', timestamp: new Date().toISOString() },
        }),
        Timestamp: new Date().toISOString(),
      });
      const res = await request(server).post('/messaging/webhook/ses').set('Content-Type', 'text/plain; charset=UTF-8').send(JSON.stringify(envelope));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, type: 'Bounce' });
      // Replaying the same notification changes nothing.
      expect((await request(server).post('/messaging/webhook/ses').set('Content-Type', 'text/plain').send(JSON.stringify(envelope))).status).toBe(200);

      const after = await prisma.notificationLog.findUniqueOrThrow({ where: { id: log.id } });
      expect(after.status).toBe('BOUNCED');
      expect(after.bouncedAt).not.toBeNull();
      expect(await prisma.messageTrackingEvent.count({ where: { notificationLogId: log.id, type: 'BOUNCE' } })).toBe(1);
      expect(await prisma.messageSuppression.count({ where: { studioId: ZEN, channel: 'EMAIL', address: bouncedEmail, reason: 'BOUNCED' } })).toBe(1);

      const next = await messaging.send({ studioId: ZEN, recipient: { contactId: bouncedContactId }, channel: 'EMAIL', templateKey: 'E2E_PROMO' });
      expect(next).toMatchObject({ success: false, reasonCode: 'OPTED_OUT' });
    });
  });

  describe('inbound and inbox', () => {
    const waFrom = phone(10);
    const smsFrom = phone(11);
    let waConversationId: string;

    const waPayload = (from: string, id: string, text: string) => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: WA_NUMBER_ID },
                contacts: [{ wa_id: from.slice(1), profile: { name: 'Deniz Inbound' } }],
                messages: [{ from: from.slice(1), id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
              },
            },
          ],
        },
      ],
    });
    const postWa = (payload: unknown, secret = WA_SECRET) => {
      const raw = JSON.stringify(payload);
      return request(server)
        .post('/messaging/webhook/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signMetaBody(raw, secret))
        .send(raw);
    };
    const postTwilio = (params: Record<string, string>, token = TWILIO_TOKEN) =>
      request(server)
        .post('/notifications/webhook/twilio/inbound')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Twilio-Signature', getExpectedTwilioSignature(token, `${PUBLIC_API}/notifications/webhook/twilio/inbound`, params))
        .send(new URLSearchParams(params).toString());

    beforeAll(async () => {
      const routing = await request(server)
        .put(`/admin/messaging/studios/${ZEN}/routing`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ whatsappPhoneNumberId: WA_NUMBER_ID, inboundSmsNumber: SMS_NUMBER });
      expect(routing.status).toBe(200);
      // Another tenant cannot take the same number.
      const clash = await request(server)
        .put(`/admin/messaging/studios/${FLOW}/routing`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ whatsappPhoneNumberId: WA_NUMBER_ID });
      expect(clash.status).toBe(409);
    });

    it('answers the WhatsApp subscription handshake only for our verify token', async () => {
      const ok = await request(server).get('/messaging/webhook/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': WA_VERIFY, 'hub.challenge': '42' });
      expect(ok.status).toBe(200);
      expect(ok.text).toBe('42');
      const bad = await request(server).get('/messaging/webhook/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' });
      expect(bad.status).toBe(403);
    });

    it('rejects a WhatsApp webhook with a bad signature', async () => {
      expect((await postWa(waPayload(waFrom, 'wamid.bad', 'x'), 'wrong-secret')).status).toBe(403);
      expect(await prisma.contact.count({ where: { studioId: ZEN, phone: waFrom } })).toBe(0);
    });

    it('an unknown WhatsApp sender becomes a contact (source INBOUND) with an open conversation; retries are ignored', async () => {
      const payload = waPayload(waFrom, 'wamid.e2e-1', 'Merhaba, fiyat alabilir miyim?');
      expect((await postWa(payload)).status).toBe(200);
      expect((await postWa(payload)).status).toBe(200);

      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: waFrom } });
      expect(contact).toMatchObject({ firstName: 'Deniz Inbound', sourceChannel: 'INBOUND', sourceDetail: 'WHATSAPP' });
      const conversation = await prisma.conversation.findFirstOrThrow({ where: { studioId: ZEN, contactId: contact.id, channel: 'WHATSAPP' }, include: { messages: true } });
      expect(conversation.status).toBe('OPEN');
      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0]).toMatchObject({ direction: 'IN', body: 'Merhaba, fiyat alabilir miyim?' });
      expect(conversation.unreadCount).toBe(1);
      waConversationId = conversation.id;
    });

    it('an inbound Twilio SMS routes to the tenant number and HELP gets the help reply', async () => {
      const bad = await postTwilio({ From: smsFrom, To: SMS_NUMBER, Body: 'x', MessageSid: 'SMe2e0' }, 'wrong');
      expect(bad.status).toBe(403);

      const res = await postTwilio({ From: smsFrom, To: SMS_NUMBER, Body: 'YARDIM', MessageSid: 'SMe2e1', NumMedia: '0' });
      expect(res.status).toBe(200);
      expect(res.text).toContain('<Response></Response>');
      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: smsFrom } });
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { contactId: contact.id, channel: 'SMS' },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      expect(conversation.messages.map((m) => m.direction)).toEqual(['IN', 'OUT']);
      expect(conversation.messages[1].body).toContain('DUR');
    });

    it('STOP / DUR opts the sender out of commercial messages on that channel', async () => {
      expect((await postWa(waPayload(waFrom, 'wamid.e2e-stop', 'DUR'))).status).toBe(200);
      expect(await prisma.messageSuppression.count({ where: { studioId: ZEN, channel: 'WHATSAPP', address: waFrom, reason: 'STOP_KEYWORD' } })).toBe(1);
      const messages = await prisma.conversationMessage.findMany({ where: { conversationId: waConversationId }, orderBy: { createdAt: 'asc' } });
      expect(messages[messages.length - 1]).toMatchObject({ direction: 'OUT' });
      expect(messages[messages.length - 1].body).toContain('Ticari mesaj listemizden');
    });

    it('inbox permissions: owner and reception see it, trainer and member do not', async () => {
      const owner = await as(ownerToken, ZEN).get(`/studios/${ZEN}/inbox/conversations?channel=WHATSAPP`);
      expect(owner.status).toBe(200);
      expect(owner.body.items.some((c: { id: string }) => c.id === waConversationId)).toBe(true);
      expect((await as(receptionToken, ZEN).get(`/studios/${ZEN}/inbox/conversations`)).status).toBe(200);
      expect((await as(trainerToken, ZEN).get(`/studios/${ZEN}/inbox/conversations`)).status).toBe(403);
      expect((await as(memberToken, ZEN).get(`/studios/${ZEN}/inbox/conversations`)).status).toBe(403);
      expect((await as(trainerToken, ZEN).post(`/studios/${ZEN}/inbox/conversations/${waConversationId}/reply`).send({ body: 'x' })).status).toBe(403);
    });

    it('tenant isolation: another tenant never sees or touches the conversation', async () => {
      expect((await as(flowOwnerToken, ZEN).get(`/studios/${ZEN}/inbox/conversations`)).status).toBe(403);
      const flowList = await as(flowOwnerToken, FLOW).get(`/studios/${FLOW}/inbox/conversations`);
      expect(flowList.status).toBe(200);
      expect(flowList.body.items.some((c: { id: string }) => c.id === waConversationId)).toBe(false);
      expect((await as(flowOwnerToken, FLOW).get(`/studios/${FLOW}/inbox/conversations/${waConversationId}`)).status).toBe(404);
      expect((await as(flowOwnerToken, FLOW).post(`/studios/${FLOW}/inbox/conversations/${waConversationId}/reply`).send({ body: 'x' })).status).toBe(404);
      expect((await as(superAdminToken, FLOW).get(`/studios/${FLOW}/inbox/conversations/${waConversationId}`)).status).toBe(404);
    });

    it('reading a conversation clears its unread count', async () => {
      const detail = await as(receptionToken, ZEN).get(`/studios/${ZEN}/inbox/conversations/${waConversationId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.messages.length).toBeGreaterThanOrEqual(2);
      expect(detail.body.whatsappWindowOpen).toBe(true);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: waConversationId } })).unreadCount).toBe(0);
    });

    it('WhatsApp 24h rule: free text inside the window, only approved templates outside it', async () => {
      const inside = await as(receptionToken, ZEN).post(`/studios/${ZEN}/inbox/conversations/${waConversationId}/reply`).send({ body: 'Fiyatlarımız ekte.' });
      expect(inside.status).toBe(201);
      const lastOut = inside.body.messages[inside.body.messages.length - 1];
      expect(lastOut).toMatchObject({ direction: 'OUT', body: 'Fiyatlarımız ekte.', status: 'SENT' });

      await prisma.conversation.update({ where: { id: waConversationId }, data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) } });
      const outside = await as(receptionToken, ZEN).post(`/studios/${ZEN}/inbox/conversations/${waConversationId}/reply`).send({ body: 'Merhaba?' });
      expect(outside.status).toBe(422);
      const templated = await as(receptionToken, ZEN)
        .post(`/studios/${ZEN}/inbox/conversations/${waConversationId}/reply`)
        .send({ templateKey: 'BOOKING_REMINDER', variables: { firstName: 'Deniz', serviceName: 'Reformer', startTime: '10:00' } });
      expect(templated.status).toBe(201);
      expect(templated.body.whatsappWindowOpen).toBe(false);

      const templates = await as(receptionToken, ZEN).get(`/studios/${ZEN}/inbox/reply-templates`);
      expect(templates.status).toBe(200);
      expect(templates.body.items.some((t: { key: string }) => t.key === 'BOOKING_REMINDER')).toBe(true);
    });

    it('assign, close and reopen need inbox.manage; a closed conversation takes no reply', async () => {
      const assign = await as(receptionToken, ZEN).patch(`/studios/${ZEN}/inbox/conversations/${waConversationId}/assign`).send({ membershipId: ownerMembershipId });
      expect(assign.status).toBe(200);
      expect(assign.body.assignedMembershipId).toBe(ownerMembershipId);
      const mine = await as(ownerToken, ZEN).get(`/studios/${ZEN}/inbox/conversations?assigned=me`);
      expect(mine.body.items.some((c: { id: string }) => c.id === waConversationId)).toBe(true);
      const memberAsAssignee = await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: MEMBER_PHONE } } });
      expect(
        (await as(ownerToken, ZEN).patch(`/studios/${ZEN}/inbox/conversations/${waConversationId}/assign`).send({ membershipId: memberAsAssignee.id })).status,
      ).toBe(400);

      expect((await as(ownerToken, ZEN).patch(`/studios/${ZEN}/inbox/conversations/${waConversationId}/status`).send({ status: 'CLOSED' })).status).toBe(200);
      expect((await as(ownerToken, ZEN).post(`/studios/${ZEN}/inbox/conversations/${waConversationId}/reply`).send({ templateKey: 'BOOKING_REMINDER' })).status).toBe(400);
      expect((await as(ownerToken, ZEN).patch(`/studios/${ZEN}/inbox/conversations/${waConversationId}/status`).send({ status: 'OPEN' })).status).toBe(200);

      // "me" assigns the caller; null unassigns; a trainer (no inbox.manage) cannot.
      const toMe = await as(receptionToken, ZEN).patch(`/studios/${ZEN}/inbox/conversations/${waConversationId}/assign`).send({ membershipId: 'me' });
      expect(toMe.status).toBe(200);
      const receptionMembership = await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: RECEPTION_PHONE } } });
      expect(toMe.body.assignedMembershipId).toBe(receptionMembership.id);
      const none = await as(receptionToken, ZEN).patch(`/studios/${ZEN}/inbox/conversations/${waConversationId}/assign`).send({ membershipId: null });
      expect(none.body.assignedMembershipId).toBeNull();
      expect((await as(trainerToken, ZEN).patch(`/studios/${ZEN}/inbox/conversations/${waConversationId}/assign`).send({ membershipId: 'me' })).status).toBe(403);
    });

    it('saved replies are tenant data managed with inbox.manage', async () => {
      const created = await as(ownerToken, ZEN).post(`/studios/${ZEN}/inbox/saved-replies`).send({ title: 'E2E Fiyat', body: 'Fiyat listemiz...' });
      expect(created.status).toBe(201);
      const list = await as(receptionToken, ZEN).get(`/studios/${ZEN}/inbox/saved-replies`);
      expect(list.body.items.some((r: { id: string }) => r.id === created.body.id)).toBe(true);
      const flow = await as(flowOwnerToken, FLOW).get(`/studios/${FLOW}/inbox/saved-replies`);
      expect(flow.body.items.some((r: { id: string }) => r.id === created.body.id)).toBe(false);
      expect((await as(flowOwnerToken, FLOW).delete(`/studios/${FLOW}/inbox/saved-replies/${created.body.id}`)).status).toBe(404);
      expect((await as(trainerToken, ZEN).post(`/studios/${ZEN}/inbox/saved-replies`).send({ title: 'E2E x', body: 'y' })).status).toBe(403);
      const updated = await as(ownerToken, ZEN).patch(`/studios/${ZEN}/inbox/saved-replies/${created.body.id}`).send({ title: 'E2E Fiyat 2', body: 'Yeni' });
      expect(updated.body.title).toBe('E2E Fiyat 2');
      expect((await as(ownerToken, ZEN).delete(`/studios/${ZEN}/inbox/saved-replies/${created.body.id}`)).status).toBe(200);
    });

    it('a member chats from the app and the message lands in the same inbox', async () => {
      const sent = await as(memberToken, ZEN).post(`/studios/${ZEN}/messaging/self/chat`).send({ body: 'Yarınki dersim için havlu getirmeli miyim?' });
      expect(sent.status).toBe(201);
      expect(sent.body.messages[sent.body.messages.length - 1]).toMatchObject({ direction: 'IN' });
      const conversationId = sent.body.conversationId as string;

      const inbox = await as(receptionToken, ZEN).get(`/studios/${ZEN}/inbox/conversations?channel=IN_APP`);
      expect(inbox.body.items.some((c: { id: string }) => c.id === conversationId)).toBe(true);
      const reply = await as(receptionToken, ZEN).post(`/studios/${ZEN}/inbox/conversations/${conversationId}/reply`).send({ body: 'Havlu stüdyoda var.' });
      expect(reply.status).toBe(201);

      const mine = await as(memberToken, ZEN).get(`/studios/${ZEN}/messaging/self/chat`);
      expect(mine.body.messages[mine.body.messages.length - 1]).toMatchObject({ direction: 'OUT', body: 'Havlu stüdyoda var.' });
      // Another member never sees it.
      expect((await as(trainerToken, ZEN).post(`/studios/${ZEN}/messaging/self/chat`).send({ body: 'x' })).status).toBe(403);
    });

    it('after a closed chat, the member sees the new open conversation and its reply', async () => {
      const first = await as(memberToken, ZEN).post(`/studios/${ZEN}/messaging/self/chat`).send({ body: 'E2E ilk soru' });
      const firstId = first.body.conversationId as string;
      expect((await as(receptionToken, ZEN).patch(`/studios/${ZEN}/inbox/conversations/${firstId}/status`).send({ status: 'CLOSED' })).status).toBe(200);

      const second = await as(memberToken, ZEN).post(`/studios/${ZEN}/messaging/self/chat`).send({ body: 'E2E ikinci soru' });
      const secondId = second.body.conversationId as string;
      expect(secondId).not.toBe(firstId);
      await as(receptionToken, ZEN).post(`/studios/${ZEN}/inbox/conversations/${secondId}/reply`).send({ body: 'E2E ikinci cevap' });

      const mine = await as(memberToken, ZEN).get(`/studios/${ZEN}/messaging/self/chat`);
      expect(mine.body).toMatchObject({ conversationId: secondId, status: 'OPEN' });
      expect(mine.body.messages[mine.body.messages.length - 1]).toMatchObject({ direction: 'OUT', body: 'E2E ikinci cevap' });
      await as(receptionToken, ZEN).patch(`/studios/${ZEN}/inbox/conversations/${secondId}/status`).send({ status: 'CLOSED' });
    });

    it('in-app messages are listed for the member and can be marked read', async () => {
      const member = await prisma.user.findUniqueOrThrow({ where: { phone: MEMBER_PHONE } });
      const sent = await messaging.send({
        studioId: ZEN,
        recipient: { userId: member.id },
        channel: 'IN_APP',
        type: 'E2E_NOTICE',
        content: { subject: 'Duyuru', text: 'Pazartesi kapalıyız.' },
      });
      expect(sent.success).toBe(true);
      const list = await as(memberToken, ZEN).get(`/studios/${ZEN}/messaging/self/in-app`);
      const item = list.body.items.find((i: { id: string }) => i.id === sent.notificationLogId);
      expect(item).toMatchObject({ subject: 'Duyuru', body: 'Pazartesi kapalıyız.', readAt: null });
      expect((await as(memberToken, ZEN).post(`/studios/${ZEN}/messaging/self/in-app/${sent.notificationLogId}/read`)).status).toBe(201);
      expect((await as(flowOwnerToken, FLOW).post(`/studios/${FLOW}/messaging/self/in-app/${sent.notificationLogId}/read`)).status).toBe(404);
    });
  });

  describe('templates and settings endpoints', () => {
    it('lists effective templates per channel and language with their source', async () => {
      const res = await as(ownerToken, ZEN).get(`/studios/${ZEN}/messaging/templates?key=BOOKING_REMINDER&channel=EMAIL`);
      expect(res.status).toBe(200);
      const locales = res.body.items.map((i: { locale: string }) => i.locale);
      expect(locales).toEqual(expect.arrayContaining(['tr', 'en']));
      const en = res.body.items.find((i: { locale: string }) => i.locale === 'en');
      expect(['GLOBAL', 'BUILTIN']).toContain(en.source);
      expect(en.subject).toBe('Session reminder');
      expect(en.variables).toEqual(expect.arrayContaining(['serviceName', 'startTime']));
    });

    it('needs notifications.manage and keeps inbound routing numbers out of tenant hands', async () => {
      expect((await as(trainerToken, ZEN).get(`/studios/${ZEN}/messaging/templates`)).status).toBe(403);
      expect((await as(receptionToken, ZEN).put(`/studios/${ZEN}/messaging/settings`).send({ frequencyCap: { perDay: 1, perWeek: 1 } })).status).toBe(403);
      expect((await as(ownerToken, ZEN).put(`/studios/${ZEN}/messaging/settings`).send({ inboundSmsNumber: '+15005550007' })).status).toBe(400);
      expect((await request(server).put(`/admin/messaging/studios/${ZEN}/routing`).set('Authorization', `Bearer ${ownerToken}`).send({})).status).toBe(403);
    });

    it('a tenant cannot mark its own WhatsApp template as Meta-approved; it stays pending and is not sent', async () => {
      const selfApproved = await as(ownerToken, ZEN)
        .put(`/studios/${ZEN}/messaging/templates`)
        .send({ key: 'E2E_WA', channel: 'WHATSAPP', locale: 'tr', body: 'Merhaba {firstName}', whatsappTemplateName: 'e2e_wa', whatsappStatus: 'APPROVED' });
      expect(selfApproved.status).toBe(400);
      const saved = await as(ownerToken, ZEN)
        .put(`/studios/${ZEN}/messaging/templates`)
        .send({ key: 'E2E_WA', channel: 'WHATSAPP', locale: 'tr', body: 'Merhaba {firstName}', whatsappTemplateName: 'e2e_wa' });
      expect(saved.status).toBe(200);
      expect(saved.body.whatsappStatus).toBe('PENDING');

      const member = await prisma.user.findUniqueOrThrow({ where: { phone: MEMBER_PHONE } });
      const result = await messaging.send({ studioId: ZEN, recipient: { userId: member.id }, channel: 'WHATSAPP', templateKey: 'E2E_WA' });
      expect(result).toMatchObject({ success: false, reasonCode: 'TEMPLATE_NOT_APPROVED' });

      // The platform owner records Meta's approval (admin content); an unchanged tenant save keeps it.
      const row = await prisma.messageTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'E2E_WA' } });
      await prisma.messageTemplate.update({ where: { id: row.id }, data: { whatsappStatus: 'APPROVED' } });
      const again = await as(ownerToken, ZEN)
        .put(`/studios/${ZEN}/messaging/templates`)
        .send({ key: 'E2E_WA', channel: 'WHATSAPP', locale: 'tr', body: 'Merhaba {firstName}', whatsappTemplateName: 'e2e_wa' });
      expect(again.body.whatsappStatus).toBe('APPROVED');
      const changed = await as(ownerToken, ZEN)
        .put(`/studios/${ZEN}/messaging/templates`)
        .send({ key: 'E2E_WA', channel: 'WHATSAPP', locale: 'tr', body: 'Selam {firstName}', whatsappTemplateName: 'e2e_wa' });
      expect(changed.body.whatsappStatus).toBe('PENDING');
    });

    it('rejects an email template without a subject and deletes only the tenant\'s own rows', async () => {
      const bad = await as(ownerToken, ZEN).put(`/studios/${ZEN}/messaging/templates`).send({ key: 'E2E_X', channel: 'EMAIL', locale: 'tr', body: 'x' });
      expect(bad.status).toBe(400);
      const own = await prisma.messageTemplate.findFirstOrThrow({ where: { studioId: ZEN, key: 'E2E_PROMO' } });
      expect((await as(flowOwnerToken, FLOW).delete(`/studios/${FLOW}/messaging/templates/${own.id}`)).status).toBe(404);
      const global = await prisma.messageTemplate.findFirstOrThrow({ where: { studioId: null, key: 'BOOKING_REMINDER' } });
      expect((await as(ownerToken, ZEN).delete(`/studios/${ZEN}/messaging/templates/${global.id}`)).status).toBe(404);
    });
  });
});
