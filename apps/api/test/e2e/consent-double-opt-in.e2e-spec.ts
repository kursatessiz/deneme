import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { Prisma, PrismaClient } from '@platform/database';
import { normalizePhone } from '@platform/shared';
import type { ApprovalSummary } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { IysClientAdapter } from '../../src/modules/notifications/consent/iys-client.adapter';
import type { IysSyncRequest } from '../../src/modules/notifications/consent/iys-client.interface';
import { MessagingService } from '../../src/modules/messaging/engine/messaging.service';
import type { SendMessageInput } from '../../src/modules/messaging/engine/messaging.types';
import { OptOutService } from '../../src/modules/messaging/engine/opt-out.service';
import { ContactConsentService } from '../../src/modules/notifications/consent/contact-consent.service';
import { ComplianceService } from '../../src/modules/compliance/compliance.service';

/**
 * M3e consent legal basis (docs/PAZARLAMA_MODULU.md 6.4): EU/UK double
 * opt-in on platform site forms, the confirmation link (hashed, single use,
 * 7 days), the resend limit, the TR merchant exemption with İYS
 * registration (mock registry), soft opt-in for existing customers by
 * region and channel, an unsubscribe beating every basis, the reason
 * counts of the M3b precheck and the audience of a real send, and other
 * tenants unchanged. Everything created here is removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const MARKER = 'M3eMarker';
const MINUTE = 60_000;

/** An IANA zone where it is currently around noon, so commercial sends are never in quiet hours. */
function daytimeZone(): string {
  const offset = 12 - new Date().getUTCHours();
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

describe('Consent legal basis and double opt-in (M3e) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let messaging: MessagingService;
  let sendSpy: jest.SpyInstance<ReturnType<MessagingService['send']>, [SendMessageInput]>;
  const iysCalls: IysSyncRequest[] = [];
  const iysMock = {
    syncConsent: jest.fn(async (req: IysSyncRequest) => {
      iysCalls.push(req);
      return { success: true, transactionId: `mock-${iysCalls.length}` };
    }),
  };
  const startedAt = new Date();
  const runId = Date.now().toString().slice(-7);

  let PLATFORM: string;
  let PLATFORM_SLUG: string;
  let ZEN: string;
  let superAdminToken: string;
  let superAdminId: string;
  let marketingToken: string;
  let viewerToken: string;
  let previousMfaPolicy: boolean | undefined;
  let previousStudio: { address: string | null; messagingSettings: Prisma.JsonValue };
  let walletExisted = false;
  let previousWallet = 0;
  let roleTemplateId: string;
  const templateKey = `M3E_SMS_${runId}`;
  const viewerRoleKey = `m3e_viewer_${runId}`;
  const marketingPhone = normalizePhone(`0535${runId}`)!;
  const viewerPhone = normalizePhone(`0533${runId}`)!;
  const dePhone = `+49151${runId}1`;
  const frPhone = `+336${runId}1`;
  const zenDePhone = `+49152${runId}1`;
  const trLegacyPhone = `+90538${runId}`;
  const trBusinessPhone = `+90537${runId}`;
  const trMemberPhone = `+90536${runId}`;
  const usMemberPhone = `+120255501${runId.slice(-2)}`;
  const createdUserPhones = [marketingPhone, viewerPhone, trMemberPhone, usMemberPhone];

  let deContactId: string;
  let frContactId: string;
  let trLegacyId: string;
  let trBusinessId: string;
  let trMemberId: string;
  let usMemberId: string;
  let segmentId: string;

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`),
  });
  const tenant = (token: string, studioId: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', studioId),
  });
  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const runScheduler = (now: Date) => as(superAdminToken).post('/admin/scheduler/run').send({ now: now.toISOString() });
  const confirmLinks = () =>
    sendSpy.mock.calls
      .map(([input]) => input)
      .filter((input) => input.templateKey === 'CONSENT_CONFIRMATION')
      .map((input) => ({ contactId: 'contactId' in input.recipient ? input.recipient.contactId : null, link: String(input.variables?.link ?? '') }));
  const tokenOf = (link: string) => link.split('/onay/')[1] ?? '';
  const lastTokenFor = (contactId: string) => tokenOf(confirmLinks().filter((l) => l.contactId === contactId).at(-1)?.link ?? '');
  const confirm = (token: string) => request(server).post(`/public/consent/confirm/${token}`).send({});
  const submitForm = (slug: string, body: Record<string, unknown>, country: string) =>
    request(server)
      .post(`/public/studios/${slug}/leads`)
      .set('cf-ipcountry', country)
      .send({ consent: true, website: '', ...body });
  const smsTo = (contactId: string) =>
    messaging.send({ studioId: PLATFORM, recipient: { contactId }, channel: 'SMS', purpose: 'COMMERCIAL', content: { text: 'M3e deneme' }, type: 'M3E_TEST' });
  const findingCount = (summary: ApprovalSummary, code: string) => summary.findings.find((f) => f.code === code)?.count ?? 0;

  async function precheck(name: string): Promise<{ campaignId: string; summary: ApprovalSummary; status: string; requestId: string; requestStatus: string }> {
    const created = await tenant(superAdminToken, PLATFORM)
      .post(`/studios/${PLATFORM}/campaigns`)
      .send({ name: `M3e e2e ${name}`, segmentId, channel: 'SMS', templateKey });
    expect(created.status).toBe(201);
    const req = await as(superAdminToken).post(`/platform/marketing/campaigns/${created.body.id}/request-approval`).send({});
    expect(req.status).toBe(200);
    return {
      campaignId: created.body.id as string,
      summary: req.body.request.summary as ApprovalSummary,
      status: req.body.campaignStatus as string,
      requestId: req.body.request.id as string,
      requestStatus: req.body.request.status as string,
    };
  }

  async function makeContact(data: Omit<Prisma.ContactUncheckedCreateInput, 'studioId' | 'lastName'>): Promise<string> {
    const contact = await prisma.contact.create({ data: { studioId: PLATFORM, lastName: MARKER, timezone: daytimeZone(), locale: 'tr', lifecycleStage: 'LEAD', ...data } });
    return contact.id;
  }

  async function memberContact(phone: string, countryCode: string): Promise<string> {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const user = await prisma.user.create({ data: { phone, firstName: 'Musteri', lastName: MARKER, passwordHash, phoneVerifiedAt: new Date(), email: `m3e-${phone.slice(1)}@example.com` } });
    const membership = await prisma.membership.create({ data: { userId: user.id, studioId: PLATFORM, roleTemplateId, status: 'ACTIVE', joinedAt: new Date() } });
    return makeContact({ firstName: 'Musteri', phone, email: user.email, countryCode, membershipId: membership.id });
  }

  async function cleanup(): Promise<void> {
    const contacts = await prisma.contact.findMany({ where: { studioId: { in: [PLATFORM, ZEN] }, lastName: MARKER }, select: { id: true } });
    const cids = contacts.map((c) => c.id);
    const campaigns = await prisma.campaign.findMany({ where: { studioId: PLATFORM, name: { startsWith: 'M3e e2e' } }, select: { id: true } });
    const ids = campaigns.map((c) => c.id);
    await prisma.approvalRequest.deleteMany({ where: { studioId: PLATFORM, targetId: { in: ids } } });
    await prisma.notificationLog.deleteMany({ where: { OR: [{ campaignId: { in: ids } }, { contactId: { in: cids } }] } });
    await prisma.campaign.deleteMany({ where: { id: { in: ids } } });
    await prisma.segment.deleteMany({ where: { studioId: PLATFORM, name: { startsWith: 'M3e e2e' } } });
    await prisma.messageSuppression.deleteMany({ where: { OR: [{ contactId: { in: cids } }, { address: { in: [dePhone, frPhone, trBusinessPhone] } }] } });
    await prisma.conversionEvent.deleteMany({ where: { contactId: { in: cids } } });
    await prisma.contact.deleteMany({ where: { id: { in: cids } } });
    await prisma.messageTemplate.deleteMany({ where: { studioId: PLATFORM, key: { startsWith: 'M3E_' } } });
    await prisma.marketingSettings.deleteMany({ where: { studioId: PLATFORM } });
    await prisma.auditLog.deleteMany({
      where: {
        studioId: PLATFORM,
        createdAt: { gte: startedAt },
        OR: [{ action: { startsWith: 'marketing.approval.' } }, { action: { startsWith: 'marketing.consent.' } }, { action: 'marketing.settings.updated' }],
      },
    });
    const users = await prisma.user.findMany({ where: { phone: { in: createdUserPhones } }, select: { id: true } });
    const uids = users.map((u) => u.id);
    await prisma.notificationLog.deleteMany({ where: { userId: { in: uids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: uids } } });
    await prisma.membership.deleteMany({ where: { userId: { in: uids } } });
    await prisma.user.deleteMany({ where: { id: { in: uids } } });
    await prisma.roleTemplate.deleteMany({ where: { studioId: PLATFORM, key: { startsWith: 'm3e_' } } });
    await prisma.platformRoleTemplate.deleteMany({ where: { key: viewerRoleKey } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IysClientAdapter)
      .useValue(iysMock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    messaging = app.get(MessagingService);
    sendSpy = jest.spyOn(messaging, 'send');

    const platform = await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } });
    PLATFORM = platform.id;
    PLATFORM_SLUG = platform.slug;
    previousStudio = { address: platform.address, messagingSettings: platform.messagingSettings };
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    await cleanup();

    await prisma.studio.update({ where: { id: PLATFORM }, data: { messagingSettings: { frequencyCap: { perDay: 50, perWeek: 200 } }, address: 'M3e e2e adres 1' } });
    const wallet = await prisma.smsWallet.findUnique({ where: { studioId: PLATFORM } });
    walletExisted = Boolean(wallet);
    previousWallet = wallet?.balance ?? 0;
    await prisma.smsWallet.upsert({ where: { studioId: PLATFORM }, create: { studioId: PLATFORM, balance: 1000 }, update: { balance: 1000 } });
    await prisma.messageTemplate.create({
      data: { studioId: PLATFORM, key: templateKey, channel: 'SMS', locale: 'tr', body: 'Merhaba {firstName}, M3e deneme. Cikis icin RET yazin.', isTransactional: false, isActive: true },
    });
    roleTemplateId = (await prisma.roleTemplate.create({ data: { studioId: PLATFORM, key: `m3e_customer_${runId}`, name: 'M3e musteri' } })).id;

    const previous = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
    previousMfaPolicy = previous?.require2faForPlatformRoles;
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', require2faForPlatformRoles: false }, update: { require2faForPlatformRoles: false } });
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const marketingRole = await prisma.platformRoleTemplate.findUniqueOrThrow({ where: { key: 'marketing_admin' } });
    const viewerRole = await prisma.platformRoleTemplate.create({
      data: { key: viewerRoleKey, name: 'M3e salt okunur', permissions: { create: [{ permissionKey: 'platform.marketing.view' }] } },
    });
    const marketing = await prisma.user.create({ data: { phone: marketingPhone, firstName: 'Pazarlama', lastName: MARKER, passwordHash, phoneVerifiedAt: new Date() } });
    const viewer = await prisma.user.create({ data: { phone: viewerPhone, firstName: 'Salt', lastName: MARKER, passwordHash, phoneVerifiedAt: new Date() } });
    await prisma.platformMembership.create({ data: { userId: marketing.id, roleTemplateId: marketingRole.id, status: 'ACTIVE', activatedAt: new Date() } });
    await prisma.platformMembership.create({ data: { userId: viewer.id, roleTemplateId: viewerRole.id, status: 'ACTIVE', activatedAt: new Date() } });

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    superAdminId = (await prisma.user.findUniqueOrThrow({ where: { phone: SUPER_ADMIN_PHONE } })).id;
    marketingToken = await login(marketingPhone);
    viewerToken = await login(viewerPhone);
  });

  afterAll(async () => {
    sendSpy?.mockRestore();
    await cleanup();
    await prisma.studio.update({
      where: { id: PLATFORM },
      data: { address: previousStudio.address, messagingSettings: (previousStudio.messagingSettings ?? {}) as Prisma.InputJsonValue },
    });
    if (walletExisted) await prisma.smsWallet.update({ where: { studioId: PLATFORM }, data: { balance: previousWallet } });
    else await prisma.smsWallet.deleteMany({ where: { studioId: PLATFORM } });
    if (previousMfaPolicy !== undefined) {
      await prisma.platformAccessSettings.update({ where: { id: 'platform' }, data: { require2faForPlatformRoles: previousMfaPolicy } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('settings', () => {
    it('defaults to double opt-in for EU and UK and the exemption off; only the super admin edits; audit logged', async () => {
      const view = await as(superAdminToken).get('/admin/marketing/settings');
      expect(view.status).toBe(200);
      expect(view.body.settings).toMatchObject({ doubleOptInRegions: ['EU', 'UK'], trMerchantExemptionEnabled: false });
      expect((await as(marketingToken).patch('/admin/marketing/settings').send({ trMerchantExemptionEnabled: true })).status).toBe(403);
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ doubleOptInRegions: ['EUROPE'] })).status).toBe(400);

      const res = await as(superAdminToken).patch('/admin/marketing/settings').send({ doubleOptInRegions: ['eu', 'UK', 'ch', 'EU'] });
      expect(res.status).toBe(200);
      expect(res.body.settings.doubleOptInRegions).toEqual(['EU', 'UK', 'CH']);
      const audit = await prisma.auditLog.findFirst({ where: { studioId: PLATFORM, action: 'marketing.settings.updated', userId: superAdminId }, orderBy: { createdAt: 'desc' } });
      expect(audit?.metadata).toMatchObject({ changes: { doubleOptInRegions: { from: ['EU', 'UK'], to: ['EU', 'UK', 'CH'] } } });
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ doubleOptInRegions: ['EU', 'UK'] })).status).toBe(200);
    });
  });

  describe('double opt-in on a platform form', () => {
    it('records an EU form consent as CONSENT waiting for confirmation and e-mails a hashed, 7-day link', async () => {
      const res = await submitForm(
        PLATFORM_SLUG,
        { fullName: `Anna ${MARKER}`, phone: dePhone, email: `anna-${runId}@example.com`, marketingConsent: true, formVersion: 'lf-tr-a1b2c3', locale: 'en' },
        'DE',
      );
      expect(res.status).toBe(202);
      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: PLATFORM, phone: dePhone } });
      deContactId = contact.id;
      await prisma.contact.update({ where: { id: deContactId }, data: { timezone: daytimeZone() } });

      const rows = await prisma.contactConsent.findMany({ where: { contactId: deContactId }, orderBy: { channel: 'asc' } });
      expect(rows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'SMS']);
      for (const row of rows) {
        expect(row).toMatchObject({ status: 'GRANTED', legalBasis: 'CONSENT', formVersion: 'lf-tr-a1b2c3', confirmedAt: null, source: 'web-form' });
        expect(row.confirmationRequestedAt).not.toBeNull();
        // Pending consents are not pushed to a registry before they count.
        expect(row.iysSyncedAt).toBeNull();
      }

      const links = confirmLinks().filter((l) => l.contactId === deContactId);
      expect(links).toHaveLength(1);
      const call = sendSpy.mock.calls.find(([input]) => input.templateKey === 'CONSENT_CONFIRMATION')![0];
      expect(call).toMatchObject({ channel: 'EMAIL', purpose: 'TRANSACTIONAL', sensitive: true, locale: 'en', variables: { formVersion: 'lf-tr-a1b2c3', days: 7 } });
      const token = tokenOf(links[0]!.link);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const confirmation = await prisma.contactConsentConfirmation.findFirstOrThrow({ where: { contactConsent: { contactId: deContactId } } });
      expect(confirmation.tokenHash).toBe(hash(token));
      expect(confirmation.tokenHash).not.toContain(token);
      expect(Object.keys(confirmation).sort()).toEqual(['confirmedAt', 'contactConsentId', 'createdAt', 'expiresAt', 'id', 'studioId', 'tokenHash']);
      const days = (confirmation.expiresAt.getTime() - confirmation.createdAt.getTime()) / (24 * 60 * MINUTE);
      expect(days).toBeCloseTo(7, 3);
      // The link itself is never stored in the delivery log.
      const log = await prisma.notificationLog.findFirst({ where: { contactId: deContactId, type: 'CONSENT_CONFIRMATION' } });
      expect(log).not.toBeNull();
      expect(log?.content ?? '').not.toContain(token);

      const detail = await tenant(superAdminToken, PLATFORM).get(`/crm/studios/${PLATFORM}/contacts/${deContactId}`);
      expect(detail.status).toBe(200);
      const sms = detail.body.consents.find((c: { channel: string }) => c.channel === 'SMS');
      expect(sms).toMatchObject({ status: 'GRANTED', legalBasis: 'CONSENT', confirmationPending: true, confirmedAt: null, formVersion: 'lf-tr-a1b2c3' });
      expect(await prisma.contactActivity.count({ where: { contactId: deContactId, type: 'CONSENT' } })).toBeGreaterThanOrEqual(3);
    });

    it('keeps the unconfirmed EU contact and every contact without a legal basis out of the commercial audience, with reason counts', async () => {
      trLegacyId = await makeContact({ firstName: 'Eski', phone: trLegacyPhone, countryCode: 'TR' });
      // A consent recorded before M3e: no legal basis column, treated as CONSENT.
      await prisma.contactConsent.create({ data: { studioId: PLATFORM, contactId: trLegacyId, channel: 'SMS', status: 'GRANTED', source: 'e2e', grantedAt: new Date(), iysSyncedAt: new Date() } });
      trBusinessId = await makeContact({ firstName: 'Tacir', phone: trBusinessPhone, countryCode: 'TR', isBusiness: true });
      trMemberId = await memberContact(trMemberPhone, 'TR');
      usMemberId = await memberContact(usMemberPhone, 'US');

      const seg = await tenant(superAdminToken, PLATFORM).post(`/studios/${PLATFORM}/segments`).send({ name: 'M3e e2e kitle', kind: 'STATIC' });
      expect(seg.status).toBe(201);
      segmentId = seg.body.id as string;
      const add = await tenant(superAdminToken, PLATFORM)
        .post(`/studios/${PLATFORM}/segments/${segmentId}/members`)
        .send({ add: [deContactId, trLegacyId, trBusinessId, trMemberId, usMemberId] });
      expect(add.status).toBe(201);

      const first = await precheck('ilk');
      expect(first.summary.audience.total).toBe(5);
      expect(first.summary.audience.reachable.SMS).toBe(1);
      expect(findingCount(first.summary, 'DOUBLE_OPT_IN_PENDING')).toBe(1);
      expect(findingCount(first.summary, 'TR_EXEMPTION_DISABLED')).toBe(1);
      // TR has no soft opt-in; US has soft opt-in for e-mail only, never SMS (TCPA).
      expect(findingCount(first.summary, 'NO_LEGAL_BASIS')).toBe(2);
      expect(findingCount(first.summary, 'CONSENT_MISSING')).toBe(0);
      expect(first.summary.legalBases).toEqual({ CONSENT: 1 });
      // Aggregates only: no contact data in the summary.
      expect(JSON.stringify(first.summary)).not.toContain(dePhone);

      // The real send drops the same contacts with the same reasons.
      if (first.requestStatus === 'PENDING') {
        expect((await as(superAdminToken).post(`/platform/marketing/approvals/${first.requestId}/approve`).send({})).status).toBe(200);
      }
      expect((await runScheduler(new Date(Date.now() + MINUTE))).status).toBe(201);
      const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId: first.campaignId } });
      const byContact = Object.fromEntries(recipients.map((r) => [r.contactId, r.status === 'SENT' ? 'SENT' : r.reasonCode]));
      expect(byContact).toEqual({
        [deContactId]: 'DOUBLE_OPT_IN_PENDING',
        [trLegacyId]: 'SENT',
        [trBusinessId]: 'TR_EXEMPTION_DISABLED',
        [trMemberId]: 'NO_LEGAL_BASIS',
        [usMemberId]: 'NO_LEGAL_BASIS',
      });
    });

    it('confirms once: an unknown or reused token reads INVALID; the contact then joins the audience', async () => {
      const token = lastTokenFor(deContactId);
      expect((await confirm('x'.repeat(43))).body).toEqual({ result: 'INVALID' });
      expect((await confirm('not-a-token')).body).toEqual({ result: 'INVALID' });
      const ok = await confirm(token);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ result: 'CONFIRMED' });
      expect((await confirm(token)).body).toEqual({ result: 'INVALID' });

      const rows = await prisma.contactConsent.findMany({ where: { contactId: deContactId } });
      expect(rows.every((r) => r.confirmedAt !== null && r.legalBasis === 'CONSENT')).toBe(true);
      expect(await prisma.contactActivity.count({ where: { contactId: deContactId, type: 'CONSENT', body: { contains: 'CONFIRMED' } } })).toBe(2);

      const sent = await smsTo(deContactId);
      expect(sent).toMatchObject({ success: true, channel: 'SMS' });
      const second = await precheck('onay sonrasi');
      expect(findingCount(second.summary, 'DOUBLE_OPT_IN_PENDING')).toBe(0);
      expect(second.summary.legalBases).toEqual({ CONSENT: 2 });
      // Nothing pending any more: a resend is refused.
      const resend = await as(marketingToken).post(`/platform/marketing/contacts/${deContactId}/resend-confirmation`).send({});
      expect(resend.status).toBe(409);
      expect(resend.body.code).toBe('CONSENT_CONFIRMATION_NOT_PENDING');
    });

    it('an expired link does not confirm; resending is limited to 3 e-mails a day per contact', async () => {
      const res = await submitForm(PLATFORM_SLUG, { fullName: `Marie ${MARKER}`, phone: frPhone, email: `marie-${runId}@example.com`, marketingConsent: true, formVersion: 'lf-fr-1' }, 'FR');
      expect(res.status).toBe(202);
      frContactId = (await prisma.contact.findFirstOrThrow({ where: { studioId: PLATFORM, phone: frPhone } })).id;
      const expired = lastTokenFor(frContactId);
      await prisma.contactConsentConfirmation.updateMany({ where: { tokenHash: hash(expired) }, data: { expiresAt: new Date(Date.now() - MINUTE) } });
      expect((await confirm(expired)).body).toEqual({ result: 'INVALID' });
      expect(await prisma.contactConsent.count({ where: { contactId: frContactId, confirmedAt: null, confirmationRequestedAt: { not: null } } })).toBe(2);

      expect((await as(viewerToken).post(`/platform/marketing/contacts/${frContactId}/resend-confirmation`).send({})).status).toBe(403);
      const r1 = await as(marketingToken).post(`/platform/marketing/contacts/${frContactId}/resend-confirmation`).send({});
      expect(r1.status).toBe(200);
      expect(r1.body).toEqual({ sent: true, sentToday: 2 });
      const r2 = await as(marketingToken).post(`/platform/marketing/contacts/${frContactId}/resend-confirmation`).send({});
      expect(r2.body).toEqual({ sent: true, sentToday: 3 });
      const r3 = await as(marketingToken).post(`/platform/marketing/contacts/${frContactId}/resend-confirmation`).send({});
      expect(r3.status).toBe(429);
      expect(r3.body.code).toBe('CONSENT_CONFIRMATION_RATE_LIMITED');
      expect(await prisma.contactConsentConfirmation.count({ where: { contactConsent: { contactId: frContactId } } })).toBe(3);
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.consent.confirmation_resent', entityId: frContactId } })).toBe(2);
      expect((await as(marketingToken).post(`/platform/marketing/contacts/00000000-0000-4000-8000-000000000000/resend-confirmation`).send({})).status).toBe(404);

      // The newest link works.
      expect((await confirm(lastTokenFor(frContactId))).body).toEqual({ result: 'CONFIRMED' });
      expect(await prisma.contactConsent.count({ where: { contactId: frContactId, confirmedAt: { not: null } } })).toBe(2);
    });
  });

  describe('TR merchant exemption', () => {
    it('includes the business contact only once the exemption is on, recorded and registered with the registry as a merchant', async () => {
      expect((await smsTo(trBusinessId)).reasonCode).toBe('TR_EXEMPTION_DISABLED');
      const before = iysCalls.length;
      const on = await as(superAdminToken).patch('/admin/marketing/settings').send({ trMerchantExemptionEnabled: true });
      expect(on.status).toBe(200);
      expect(on.body.settings.trMerchantExemptionEnabled).toBe(true);

      const rows = await prisma.contactConsent.findMany({ where: { contactId: trBusinessId } });
      expect(rows.map((r) => r.channel).sort()).toEqual(['SMS', 'WHATSAPP']);
      for (const row of rows) {
        expect(row).toMatchObject({ status: 'GRANTED', legalBasis: 'TR_MERCHANT_EXEMPTION', source: 'tr-merchant-exemption' });
        expect(row.iysSyncedAt).not.toBeNull();
      }
      const registered = iysCalls.slice(before).filter((c) => c.recipient === trBusinessPhone);
      expect(registered.map((c) => c.channel).sort()).toEqual(['SMS', 'WHATSAPP']);
      expect(registered.every((c) => c.type === 'GRANTED' && c.recipientType === 'MERCHANT')).toBe(true);
      expect(await prisma.auditLog.count({ where: { studioId: PLATFORM, action: 'marketing.consent.merchant_exemption_applied' } })).toBe(1);

      const check = await precheck('muafiyet acik');
      expect(findingCount(check.summary, 'TR_EXEMPTION_DISABLED')).toBe(0);
      expect(check.summary.legalBases).toEqual({ CONSENT: 2, TR_MERCHANT_EXEMPTION: 1 });
      expect(await smsTo(trBusinessId)).toMatchObject({ success: true, channel: 'SMS' });

      // Switched off again: the recorded exemption no longer counts.
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ trMerchantExemptionEnabled: false })).status).toBe(200);
      expect((await smsTo(trBusinessId)).reasonCode).toBe('TR_EXEMPTION_DISABLED');
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ trMerchantExemptionEnabled: true })).status).toBe(200);
    });

    it('an unsubscribe beats every basis: exemption, confirmed consent and existing customer', async () => {
      const optOut = app.get(OptOutService);
      await optOut.optOut({ studioId: PLATFORM, channel: 'SMS', address: trBusinessPhone, reason: 'STOP_KEYWORD', contactId: trBusinessId, countryCode: 'TR', source: 'stop-keyword' });
      expect((await smsTo(trBusinessId)).reasonCode).toBe('OPTED_OUT');
      // The revocation stays even without the suppression row, and turning the exemption on again does not undo it.
      await prisma.messageSuppression.deleteMany({ where: { address: trBusinessPhone } });
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ trMerchantExemptionEnabled: false })).status).toBe(200);
      expect((await as(superAdminToken).patch('/admin/marketing/settings').send({ trMerchantExemptionEnabled: true })).status).toBe(200);
      expect(await prisma.contactConsent.findFirst({ where: { contactId: trBusinessId, channel: 'SMS' } })).toMatchObject({ status: 'REVOKED' });
      expect((await smsTo(trBusinessId)).reasonCode).toBe('CONSENT_REQUIRED');

      await optOut.optOut({ studioId: PLATFORM, channel: 'SMS', address: dePhone, reason: 'UNSUBSCRIBED', contactId: deContactId, countryCode: 'DE', source: 'unsubscribe-link' });
      expect((await smsTo(deContactId)).reasonCode).toBe('OPTED_OUT');

      const usContact = await prisma.contact.findUniqueOrThrow({ where: { id: usMemberId } });
      await optOut.optOut({ studioId: PLATFORM, channel: 'EMAIL', address: usContact.email!, reason: 'UNSUBSCRIBED', contactId: usMemberId, countryCode: 'US', source: 'unsubscribe-link' });
      const email = await messaging.send({ studioId: PLATFORM, recipient: { contactId: usMemberId }, channel: 'EMAIL', purpose: 'COMMERCIAL', content: { subject: 'M3e', text: 'M3e deneme' }, type: 'M3E_TEST' });
      expect(email.reasonCode).toBe('OPTED_OUT');
    });
  });

  describe('existing customers (soft opt-in)', () => {
    it('lets a US customer receive commercial e-mail under EXISTING_CUSTOMER but not SMS; a TR customer gets neither', async () => {
      const facts = app.get(ContactConsentService);
      const compliance = app.get(ComplianceService);
      const decide = async (contactId: string, countryCode: string, channel: 'EMAIL' | 'SMS') => {
        const f = await facts.commercialFacts(PLATFORM, contactId, null, channel);
        return compliance.canSend({ recipient: { countryCode, timezone: daytimeZone(), consentGranted: false, legalBasis: f }, channel, purpose: 'COMMERCIAL', skipQuietHours: true });
      };
      // A fresh US customer (the one above has unsubscribed from e-mail).
      const other = await memberContact(`+120255502${runId.slice(-2)}`, 'US');
      createdUserPhones.push(`+120255502${runId.slice(-2)}`);
      expect(await decide(other, 'US', 'EMAIL')).toMatchObject({ allow: true, legalBasis: 'EXISTING_CUSTOMER' });
      expect(await decide(other, 'US', 'SMS')).toMatchObject({ allow: false, reasonCode: 'NO_LEGAL_BASIS' });
      expect(await decide(trMemberId, 'TR', 'EMAIL')).toMatchObject({ allow: false, reasonCode: 'NO_LEGAL_BASIS' });
      const email = await messaging.send({ studioId: PLATFORM, recipient: { contactId: other }, channel: 'EMAIL', purpose: 'COMMERCIAL', content: { subject: 'M3e', text: 'M3e deneme' }, type: 'M3E_TEST' });
      expect(email).toMatchObject({ success: true, channel: 'EMAIL' });

      // No longer a customer: the derived basis lapses and an explicit consent is needed again.
      await prisma.membership.updateMany({ where: { user: { phone: `+120255502${runId.slice(-2)}` } }, data: { status: 'PASSIVE' } });
      expect(await decide(other, 'US', 'EMAIL')).toMatchObject({ allow: false, reasonCode: 'CONSENT_REQUIRED' });
    });
  });

  describe('other tenants', () => {
    it('keep single opt-in form consents and need an explicit consent, as before', async () => {
      const previousLinks = confirmLinks().length;
      const res = await submitForm('zen-reformer-pilates', { fullName: `Lena ${MARKER}`, phone: zenDePhone, email: `lena-${runId}@example.com`, marketingConsent: true, formVersion: 'zen-1' }, 'DE');
      expect(res.status).toBe(202);
      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: zenDePhone } });
      const rows = await prisma.contactConsent.findMany({ where: { contactId: contact.id } });
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.status === 'GRANTED' && r.confirmationRequestedAt === null)).toBe(true);
      expect(await prisma.contactConsentConfirmation.count({ where: { studioId: ZEN } })).toBe(0);
      expect(confirmLinks().length).toBe(previousLinks);

      const facts = app.get(ContactConsentService);
      const compliance = app.get(ComplianceService);
      const f = await facts.commercialFacts(ZEN, contact.id, null, 'SMS');
      expect(f.policy).toBeNull();
      expect(compliance.canSend({ recipient: { countryCode: 'DE', timezone: null, consentGranted: false, legalBasis: f }, channel: 'SMS', purpose: 'COMMERCIAL', skipQuietHours: true })).toMatchObject({ allow: true });

      const business = await prisma.contact.create({ data: { studioId: ZEN, firstName: 'Tacir', lastName: MARKER, phone: `+90534${runId}`, countryCode: 'TR', isBusiness: true } });
      const bf = await facts.commercialFacts(ZEN, business.id, null, 'SMS');
      expect(compliance.canSend({ recipient: { countryCode: 'TR', timezone: null, consentGranted: false, legalBasis: bf }, channel: 'SMS', purpose: 'COMMERCIAL', skipQuietHours: true })).toMatchObject({
        allow: false,
        reasonCode: 'CONSENT_REQUIRED',
      });
    });
  });
});
