process.env.OTP_TEST_CODE ??= '482915';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@platform/database';
import { normalizePhone } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { DNS_LOOKUP } from '../../src/modules/platform-marketing/integrations/integration-hub.service';
import type { DnsLookup } from '../../src/modules/platform-marketing/integrations/email-domain-dns';
import { totpAt } from '../../src/modules/auth/mfa/totp';

/**
 * M1 platform access (docs/PAZARLAMA_MODULU.md): the super admin invites a
 * marketing admin, who onboards through the regular invite flow, enrols
 * TOTP and works on the platform tenant only; revocation, the system role
 * lock, the integrations hub from both entry points, recovery codes, the
 * super admin 2FA grace, and the audit trail.
 *
 * One OTP request (the invite) keeps this file well inside the shared
 * per-IP OTP budget; every row it creates is removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OTP_TEST_CODE = process.env.OTP_TEST_CODE as string;
const SUPER_ADMIN_PHONE = '+905321000001';

/** Deterministic zone for the email domain check: only SPF is published. */
const fakeDns: DnsLookup = {
  resolveTxt: async (name) => {
    if (name.startsWith('mail.')) return [['v=spf1 include:amazonses.com ~all']];
    throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  },
  resolveCname: async () => {
    throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  },
  resolveMx: async () => [],
};

/** A code for a time step after `usedStep`, so single-use protection never trips on a legitimate call. */
function freshCode(secret: string, offsetSteps = 0): string {
  return totpAt(secret, Math.floor(Date.now() / 1000) + offsetSteps * 30);
}

describe('Platform access (M1) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;

  let PLATFORM: string;
  let ZEN: string;
  let superAdminId: string;
  let superAdminToken: string;

  const runId = Date.now().toString().slice(-7);
  const inviteePhone = normalizePhone(`0535${runId}`)!;
  const tempAdminPhone = normalizePhone(`0536${runId}`)!;
  const emailDomain = `m1-${runId}.example.com`;
  const adLabel = `M1 hub ${runId}`;

  let marketingUserId: string;
  let marketingRefresh: string;
  let tokenNoMfa: string;
  let tokenMfa: string;
  let totpSecret: string;
  let confirmCode: string;
  let recoveryCodes: string[];
  let systemRoleTemplateId: string;
  let adConnectionId: string;
  let apiKeyId: string;
  let emailDomainId: string;

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DNS_LOOKUP).useValue(fakeDns).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    PLATFORM = (await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } })).id;
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    superAdminId = (await prisma.user.findUniqueOrThrow({ where: { phone: SUPER_ADMIN_PHONE } })).id;
    const login = await request(server).post('/auth/login').send({ emailOrPhone: '05321000001', password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    superAdminToken = login.body.accessToken;
    // The policy is the default (2FA required) for this suite.
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform' }, update: { require2faForPlatformRoles: true } });
  });

  afterAll(async () => {
    const phones = [inviteePhone, tempAdminPhone];
    const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await prisma.otpChallenge.deleteMany({ where: { phone: { in: phones } } });
    await prisma.notificationLog.deleteMany({ where: { recipientPhone: { in: phones } } });
    await prisma.inviteToken.deleteMany({ where: { phone: { in: phones } } });
    await prisma.emailSenderDomain.deleteMany({ where: { domain: emailDomain } });
    await prisma.adConnection.deleteMany({ where: { studioId: PLATFORM, label: adLabel } });
    if (apiKeyId) await prisma.apiKey.deleteMany({ where: { id: apiKeyId } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { entityId: { in: [...userIds, adConnectionId, apiKeyId, emailDomainId].filter(Boolean) as string[] } },
        ],
      },
    });
    await prisma.consent.deleteMany({ where: { membership: { userId: { in: userIds } } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('invite and onboarding', () => {
    let inviteToken: string;

    it('the seeded "Pazarlama yöneticisi" platform role exists', async () => {
      const res = await as(superAdminToken).get('/admin/platform-users/role-templates');
      expect(res.status).toBe(200);
      const role = res.body.find((r: { key: string }) => r.key === 'marketing_admin');
      expect(role).toMatchObject({ name: 'Pazarlama yöneticisi', isSystem: true });
      expect(role.permissions).toContain('platform.integrations.manage');
      expect(role.permissions).not.toContain('platform.users.manage');
    });

    it('super admin invites by phone; the invite is audit logged with actor and target', async () => {
      const roles = await as(superAdminToken).get('/admin/platform-users/role-templates');
      const roleTemplateId = roles.body.find((r: { key: string }) => r.key === 'marketing_admin').id;
      const res = await as(superAdminToken)
        .post('/admin/platform-users/invites')
        .send({ fullName: 'Pazarlama Deneme', phone: inviteePhone, roleTemplateId, channel: 'SHOWN' });
      expect(res.status).toBe(201);
      expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      inviteToken = res.body.token;
      marketingUserId = res.body.userId;

      const list = await as(superAdminToken).get('/admin/platform-users');
      expect(list.body.find((m: { userId: string }) => m.userId === marketingUserId)).toMatchObject({ status: 'INVITED', mfaEnabled: false });
      expect(JSON.stringify(list.body)).not.toContain(inviteePhone);

      const audit = await prisma.auditLog.findFirst({ where: { action: 'platform_user.invited', entityId: marketingUserId } });
      expect(audit?.userId).toBe(superAdminId);
      expect(audit?.metadata).toMatchObject({ targetUserId: marketingUserId, via: 'admin' });
    });

    it('a platform role is not a normal member invite and a platform member is not a super admin', async () => {
      const res = await as(superAdminToken).get('/admin/platform-users');
      expect(res.status).toBe(200);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: marketingUserId } });
      expect(user.isSuperAdmin).toBe(false);
    });

    it('the invitee completes the regular OTP -> PIN -> consent flow and lands in the platform membership', async () => {
      const preview = await request(server).get(`/invites/${inviteToken}`);
      expect(preview.status).toBe(200);
      expect(preview.body.isPlatformInvite).toBe(true);
      expect(preview.body.roleName).toBe('Pazarlama yöneticisi');
      // Staff of the platform accept the privacy notice only, not a customer contract.
      expect(preview.body.documents.map((d: { type: string }) => d.type)).toEqual(['KVKK_NOTICE']);

      expect((await request(server).post(`/invites/${inviteToken}/otp`)).status).toBe(202);
      const accept = await request(server)
        .post(`/invites/${inviteToken}/accept`)
        .send({ code: OTP_TEST_CODE, pin: '481357', acceptedDocumentVersionIds: preview.body.documents.map((d: { id: string }) => d.id) });
      expect(accept.status).toBe(200);
      tokenNoMfa = accept.body.accessToken;
      expect(accept.body.user.platformAccess.permissions).toContain('platform.marketing.view');
      expect(accept.body.user.mfa).toEqual({ enabled: false, verified: false, enrollmentRequired: true });

      const pm = await prisma.platformMembership.findUniqueOrThrow({ where: { userId: marketingUserId } });
      expect(pm.status).toBe('ACTIVE');
      const membership = await prisma.membership.findUniqueOrThrow({
        where: { id: pm.platformStudioMembershipId! },
        include: { roleTemplate: { include: { permissions: true } } },
      });
      expect(membership).toMatchObject({ studioId: PLATFORM, status: 'ACTIVE' });
      expect(membership.roleTemplate).toMatchObject({ key: 'platform:marketing_admin', isSystem: true, isOwner: false });
      const keys = membership.roleTemplate.permissions.map((p) => p.permissionKey);
      expect(keys).toEqual(expect.arrayContaining(['crm.view', 'segments.view', 'integrations.manage']));
      for (const forbidden of ['roles.manage', 'staff.manage', 'billing.manage', 'finance.view', 'payouts.view', 'crm.export']) {
        expect(keys).not.toContain(forbidden);
      }
      systemRoleTemplateId = membership.roleTemplateId;
      expect(await prisma.auditLog.count({ where: { action: 'platform_user.activated', entityId: marketingUserId } })).toBe(1);
    });

    it('without 2FA the platform tenant and platform endpoints answer MFA_ENROLLMENT_REQUIRED', async () => {
      const contacts = await as(tokenNoMfa).get(`/crm/studios/${PLATFORM}/contacts`);
      expect(contacts.status).toBe(403);
      expect(contacts.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
      const hub = await as(tokenNoMfa).get('/platform/integrations');
      expect(hub.status).toBe(403);
      expect(hub.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
    });
  });

  describe('2FA enrolment, verification and recovery', () => {
    it('enrols with a TOTP code and receives 10 recovery codes and an upgraded session', async () => {
      const start = await as(tokenNoMfa).post('/auth/mfa/enroll');
      expect(start.status).toBe(200);
      expect(start.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      totpSecret = start.body.secret;

      const good = freshCode(totpSecret);
      const bad = `${(Number(good[0]) + 5) % 10}${good.slice(1)}`;
      const wrong = await as(tokenNoMfa).post('/auth/mfa/enroll/confirm').send({ code: bad });
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe('MFA_INVALID_CODE');

      confirmCode = freshCode(totpSecret);
      const confirm = await as(tokenNoMfa).post('/auth/mfa/enroll/confirm').send({ code: confirmCode });
      expect(confirm.status).toBe(200);
      expect(confirm.body.recoveryCodes).toHaveLength(10);
      expect(confirm.body.user.mfa).toEqual({ enabled: true, verified: true, enrollmentRequired: false });
      recoveryCodes = confirm.body.recoveryCodes;
      tokenMfa = confirm.body.accessToken;
      marketingRefresh = confirm.body.refreshToken;

      const stored = await prisma.userMfaRecoveryCode.findMany({ where: { userId: marketingUserId } });
      expect(stored).toHaveLength(10);
      expect(stored.some((r) => recoveryCodes.includes(r.codeHash))).toBe(false);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: marketingUserId } });
      expect(user.totpSecretEncrypted).not.toContain(totpSecret);
      expect(await prisma.auditLog.count({ where: { action: 'mfa.enabled', userId: marketingUserId } })).toBe(1);
    });

    it('the same TOTP code is never accepted twice', async () => {
      const replay = await as(tokenNoMfa).post('/auth/mfa/verify').send({ code: confirmCode });
      expect(replay.status).toBe(401);
    });

    it('a session from before enrolment is refused with MFA_REQUIRED', async () => {
      const res = await as(tokenNoMfa).get(`/crm/studios/${PLATFORM}/contacts`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });

    it('PIN login, then a recovery code (single use) upgrades the session', async () => {
      const pin = await request(server).post('/auth/pin/login').send({ phone: inviteePhone, pin: '481357' });
      expect(pin.status).toBe(200);
      expect(pin.body.user.mfa).toEqual({ enabled: true, verified: false, enrollmentRequired: false });
      const plain = pin.body.accessToken as string;

      const verified = await as(plain).post('/auth/mfa/verify').send({ recoveryCode: recoveryCodes[0].toUpperCase() });
      expect(verified.status).toBe(200);
      expect(verified.body.user.mfa.verified).toBe(true);
      tokenMfa = verified.body.accessToken;
      marketingRefresh = verified.body.refreshToken;

      const again = await as(plain).post('/auth/mfa/verify').send({ recoveryCode: recoveryCodes[0] });
      expect(again.status).toBe(401);
      expect(await prisma.auditLog.count({ where: { action: 'mfa.recovery_code_used', userId: marketingUserId } })).toBe(1);
    });

    it('a refreshed session keeps the TOTP step', async () => {
      const refreshed = await request(server).post('/auth/refresh').send({ refreshToken: marketingRefresh });
      expect(refreshed.status).toBe(200);
      tokenMfa = refreshed.body.accessToken;
      marketingRefresh = refreshed.body.refreshToken;
      const me = await as(tokenMfa).get('/auth/me');
      expect(me.body.mfa.verified).toBe(true);
    });
  });

  describe('what the marketing admin can and cannot do', () => {
    it('reads platform-tenant contacts and segments', async () => {
      expect((await as(tokenMfa).get(`/crm/studios/${PLATFORM}/contacts`)).status).toBe(200);
      expect((await as(tokenMfa).get(`/studios/${PLATFORM}/segments`)).status).toBe(200);
      const ctx = await as(tokenMfa).get('/platform/context');
      expect(ctx.status).toBe(200);
      expect(ctx.body).toMatchObject({ platformStudioId: PLATFORM, isSuperAdmin: false });
      expect(ctx.body.tenantPermissions).not.toContain('roles.manage');
    });

    it('gets 403 on another tenant', async () => {
      expect((await as(tokenMfa).get(`/crm/studios/${ZEN}/contacts`)).status).toBe(403);
      expect((await as(tokenMfa).get(`/studios/${ZEN}/segments`)).status).toBe(403);
    });

    it('gets 403 on tenant CRUD, plans, billing, health and platform user management', async () => {
      for (const url of ['/admin/tenants', '/admin/plans', '/admin/billing/settings', '/admin/health', '/admin/feature-flags', '/admin/platform-users']) {
        const res = await as(tokenMfa).get(url);
        expect({ url, status: res.status }).toEqual({ url, status: 403 });
      }
    });

    it('gets 403 on roles.manage, cannot invite into the platform tenant and cannot export contacts', async () => {
      expect((await as(tokenMfa).get(`/role-templates/studio/${PLATFORM}`)).status).toBe(403);
      expect((await as(tokenMfa).get(`/role-templates/studio/${PLATFORM}/staff`)).status).toBe(403);
      const invite = await as(tokenMfa)
        .post('/invites')
        .send({ studioId: PLATFORM, fullName: 'Baska Biri', phone: tempAdminPhone, roleKey: 'member', channel: 'SHOWN' });
      expect(invite.status).toBe(403);
      expect((await as(tokenMfa).get(`/crm/studios/${PLATFORM}/contacts/export`)).status).toBe(403);
    });
  });

  describe('system role lock and tenant invite path', () => {
    it('the mirrored system role cannot be edited, deleted or assigned, even by the super admin', async () => {
      const edit = await as(superAdminToken).put(`/role-templates/${systemRoleTemplateId}`).set('x-studio-id', PLATFORM).send({ name: 'Degisti' });
      expect(edit.status).toBe(403);
      expect(edit.body.code).toBe('SYSTEM_ROLE_LOCKED');
      const del = await as(superAdminToken).delete(`/role-templates/${systemRoleTemplateId}`).set('x-studio-id', PLATFORM);
      expect(del.status).toBe(403);
      const pm = await prisma.platformMembership.findUniqueOrThrow({ where: { userId: marketingUserId } });
      const assign = await as(superAdminToken)
        .put(`/role-templates/staff/${pm.platformStudioMembershipId}`)
        .set('x-studio-id', PLATFORM)
        .send({ roleTemplateId: systemRoleTemplateId });
      expect(assign.status).toBe(403);
    });

    it('the normal tenant invite path refuses the platform tenant, even for the super admin', async () => {
      const res = await as(superAdminToken)
        .post('/invites')
        .send({ studioId: PLATFORM, fullName: 'Baska Biri', phone: tempAdminPhone, roleKey: 'member', channel: 'SHOWN' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLATFORM_TENANT_INVITE_FORBIDDEN');
    });
  });

  describe('integrations hub from both entry points', () => {
    it('the super admin and the marketing admin read the same hub; secrets never appear', async () => {
      const created = await as(superAdminToken)
        .post(`/studios/${PLATFORM}/ads/connections`)
        .send({ platform: 'META', label: adLabel, externalAccountId: 'act_m1', credentials: { accessToken: 'EAABm1secret9876', pixelId: '123456789012345' } });
      expect(created.status).toBe(201);
      adConnectionId = created.body.id;

      const admin = await as(superAdminToken).get('/platform/integrations').set('x-platform-entry', 'admin');
      expect(admin.status).toBe(200);
      expect(admin.body.platformCards.map((c: { key: string }) => c.key)).toEqual(['ai', 'smsBalance', 'payments']);

      const marketing = await as(tokenMfa).get('/platform/integrations');
      expect(marketing.status).toBe(200);
      expect(marketing.body.platformCards).toEqual([]);
      const ad = marketing.body.adConnections.find((a: { id: string }) => a.id === adConnectionId);
      expect(ad.credentialPreview).toBe('****9876');
      for (const body of [admin.body, marketing.body]) expect(JSON.stringify(body)).not.toContain('EAABm1secret9876');
    });

    it('a change from either entry point edits the same record and the audit says which one', async () => {
      const fromMarketing = await as(tokenMfa).patch(`/platform/integrations/ads/${adConnectionId}`).set('x-platform-entry', 'admin').send({ isTestMode: true });
      expect(fromMarketing.status).toBe(200);
      const fromAdmin = await as(superAdminToken).patch(`/platform/integrations/ads/${adConnectionId}`).set('x-platform-entry', 'admin').send({ label: `${adLabel} b` });
      expect(fromAdmin.status).toBe(200);
      const row = await prisma.adConnection.findUniqueOrThrow({ where: { id: adConnectionId } });
      expect(row).toMatchObject({ isTestMode: true, label: `${adLabel} b` });
      await prisma.adConnection.update({ where: { id: adConnectionId }, data: { label: adLabel } });

      const audits = await prisma.auditLog.findMany({ where: { action: 'integration.ads.update', entityId: adConnectionId }, orderBy: { createdAt: 'asc' } });
      // A marketing admin cannot claim the admin entry point.
      expect(audits.map((a) => [a.userId, (a.metadata as { via: string }).via])).toEqual([
        [marketingUserId, 'marketing'],
        [superAdminId, 'admin'],
      ]);
      expect(audits.every((a) => a.studioId === PLATFORM)).toBe(true);
    });

    it('API keys: the plaintext is returned once at creation, the hub only shows the prefix', async () => {
      const created = await as(tokenMfa).post('/platform/integrations/api-keys').send({ name: `Zapier ${runId}`, scopes: ['webhooks.manage'] });
      expect(created.status).toBe(201);
      apiKeyId = created.body.id;
      const hub = await as(tokenMfa).get('/platform/integrations');
      expect(JSON.stringify(hub.body)).not.toContain(created.body.plaintext);
      expect(hub.body.apiKeys.find((k: { id: string }) => k.id === apiKeyId).prefix).toBe(created.body.prefix);
    });

    it('email sender domain: expected records, DNS check with statuses, not verified until all three pass', async () => {
      const created = await as(tokenMfa)
        .post('/platform/integrations/email-domains')
        .send({ domain: emailDomain, mailFromDomain: `mail.${emailDomain}`, dkimTokens: ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)] });
      expect(created.status).toBe(201);
      emailDomainId = created.body.id;
      expect(created.body.expectedRecords.map((r: { kind: string }) => r.kind)).toEqual(['SPF', 'DKIM', 'DKIM', 'DKIM', 'DMARC', 'MAIL_FROM_MX']);

      const checked = await as(superAdminToken).post(`/platform/integrations/email-domains/${emailDomainId}/check`).set('x-platform-entry', 'admin');
      expect(checked.status).toBe(200);
      expect(checked.body).toMatchObject({ spfStatus: 'VALID', dkimStatus: 'MISSING', dmarcStatus: 'MISSING', verified: false });
      expect(checked.body.lastCheckedAt).not.toBeNull();
      const audit = await prisma.auditLog.findFirst({ where: { action: 'integration.email_domain.check', entityId: emailDomainId } });
      expect((audit?.metadata as { via: string }).via).toBe('admin');
    });
  });

  describe('revocation, reactivation and 2FA reset', () => {
    it('deactivation takes effect on the very next request and kills the refresh token', async () => {
      const res = await as(superAdminToken).post(`/admin/platform-users/${marketingUserId}/deactivate`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PASSIVE');

      expect((await as(tokenMfa).get(`/crm/studios/${PLATFORM}/contacts`)).status).toBe(403);
      expect((await as(tokenMfa).get('/platform/integrations')).status).toBe(403);
      expect((await as(tokenMfa).get('/platform/context')).status).toBe(403);
      expect((await request(server).post('/auth/refresh').send({ refreshToken: marketingRefresh })).status).toBe(401);
      const me = await as(tokenMfa).get('/auth/me');
      expect(me.body.platformAccess).toBeNull();
      expect(await prisma.auditLog.count({ where: { action: 'platform_user.deactivated', entityId: marketingUserId, userId: superAdminId } })).toBe(1);
    });

    it('reactivation restores access; a role change is audit logged', async () => {
      const res = await as(superAdminToken).post(`/admin/platform-users/${marketingUserId}/reactivate`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACTIVE');
      expect((await as(tokenMfa).get(`/crm/studios/${PLATFORM}/contacts`)).status).toBe(200);

      const role = await as(superAdminToken).put(`/admin/platform-users/${marketingUserId}/role`).send({ roleTemplateId: res.body.roleTemplateId });
      expect(role.status).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: { in: ['platform_user.reactivated', 'platform_user.role_changed'] }, entityId: marketingUserId } })).toBe(2);
    });

    it('a super admin 2FA reset invalidates the TOTP session and sends the member back to enrolment', async () => {
      const res = await as(superAdminToken).post(`/admin/platform-users/${marketingUserId}/mfa/reset`);
      expect(res.status).toBe(200);
      expect(res.body.mfaEnabled).toBe(false);
      const after = await as(tokenMfa).get(`/crm/studios/${PLATFORM}/contacts`);
      expect(after.status).toBe(403);
      expect(after.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
      expect(await prisma.userMfaRecoveryCode.count({ where: { userId: marketingUserId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: 'platform_user.mfa_reset', entityId: marketingUserId, userId: superAdminId } })).toBe(1);
    });
  });

  describe('super admin 2FA (grace, then enforced once enrolled)', () => {
    let tempId: string;
    let plainToken: string;

    beforeAll(async () => {
      const temp = await prisma.user.create({
        data: { phone: tempAdminPhone, firstName: 'Gecici', lastName: 'Admin', isSuperAdmin: true, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) },
      });
      tempId = temp.id;
    });

    it('without 2FA the super admin keeps working and /auth/me asks for enrolment', async () => {
      const login = await request(server).post('/auth/login').send({ emailOrPhone: tempAdminPhone, password: DEMO_PASSWORD });
      expect(login.status).toBe(200);
      plainToken = login.body.accessToken;
      expect(login.body.user.mfa).toEqual({ enabled: false, verified: false, enrollmentRequired: true });
      expect((await as(plainToken).get('/admin/tenants')).status).toBe(200);
    });

    it('after enrolment a session without the TOTP step gets MFA_REQUIRED; the TOTP step restores access', async () => {
      const start = await as(plainToken).post('/auth/mfa/enroll');
      const confirm = await as(plainToken).post('/auth/mfa/enroll/confirm').send({ code: freshCode(start.body.secret) });
      expect(confirm.status).toBe(200);

      const stale = await as(plainToken).get('/admin/tenants');
      expect(stale.status).toBe(403);
      expect(stale.body.code).toBe('MFA_REQUIRED');

      const login = await request(server).post('/auth/login').send({ emailOrPhone: tempAdminPhone, password: DEMO_PASSWORD });
      expect(login.body.user.mfa).toEqual({ enabled: true, verified: false, enrollmentRequired: false });
      expect((await as(login.body.accessToken).get('/admin/tenants')).status).toBe(403);
      const verified = await as(login.body.accessToken).post('/auth/mfa/verify').send({ code: freshCode(start.body.secret, 1) });
      expect(verified.status).toBe(200);
      expect((await as(verified.body.accessToken).get('/admin/tenants')).status).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: 'mfa.enabled', userId: tempId } })).toBe(1);
    });
  });
});
