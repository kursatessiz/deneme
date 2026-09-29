import { hashOAuthState } from '../../src/modules/platform-marketing/oauth/oauth-crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { Prisma, PrismaClient } from '@platform/database';
import { normalizePhone } from '@platform/shared';
import type { IntegrationHubDTO, OAuthClientSettingsDTO, OAuthStartResultDTO } from '@platform/shared';

// Real AES-GCM for this suite, so "no plaintext in the database" is checked against ciphertext,
// not the dev/test plaintext envelope. Must be set before AppModule loads; removed in afterAll.
const previousEncryptionKey = process.env.INTEGRATION_ENCRYPTION_KEY;
process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('base64');

import { AppModule } from '../../src/app.module';
import { CredentialCipher } from '../../src/common/crypto/credential-cipher';
import { OAuthRefreshService } from '../../src/modules/platform-marketing/oauth/oauth-refresh.service';

/**
 * M4a OAuth connect (docs/PAZARLAMA_MODULU.md 5.2): super admin client
 * settings (masked), start -> provider consent -> callback for Google Ads,
 * Meta (ad account and Facebook Page) and LinkedIn (organization), state
 * single use / expiry / provider binding, a failed code exchange, the
 * background refresh (rotation, transient backoff, permanent failure ->
 * REAUTH_REQUIRED), reconnect, the hub fields, rate limits and tenant
 * isolation. The providers are a fake behind global fetch: the allow-listed
 * HTTP client runs for real and nothing leaves the process. Everything
 * created here is removed in afterAll.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const SUPER_ADMIN_PHONE = '+905321000001';
const ZEN_OWNER_PHONE = '+905321000002';
const MARKER = 'M4aMarker';
const LABEL = 'M4a e2e';
const APP_ORIGIN = new URL(process.env.PUBLIC_APP_URL ?? 'http://localhost:3000').origin;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const GOOGLE_SECRET = 'GOCSPX-m4a-e2e-client-secret';
const GOOGLE_DEV_TOKEN = 'm4a-e2e-developer-token';
const META_SECRET = 'm4a-e2e-meta-app-secret-000';
const LINKEDIN_SECRET = 'm4a-e2e-linkedin-secret-000';

interface FakeCall {
  host: string;
  path: string;
  method: string;
  body: URLSearchParams;
  query: URLSearchParams;
  headers: Record<string, string>;
}

/** Scripted OAuth providers answering on the allow-listed hosts only. */
class FakeProviders {
  readonly calls: FakeCall[] = [];
  readonly unexpected: string[] = [];
  expectedGoogleChallenge: string | null = null;
  googleRefreshRevoked = false;
  linkedinDown = false;
  private seq = 0;

  constructor(
    private readonly ids: { customer: string; adAccount: string; page: string; instagram: string; org: string },
  ) {}

  handle(url: URL, method: string, bodyText: string, headers: Record<string, string>): Response {
    const body = new URLSearchParams(bodyText);
    this.calls.push({ host: url.hostname, path: url.pathname, method, body, query: url.searchParams, headers });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    const n = ++this.seq;

    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token' && method === 'POST') {
      if (body.get('client_secret') !== GOOGLE_SECRET) return json(401, { error: 'invalid_client' });
      if (body.get('grant_type') === 'authorization_code') {
        if (body.get('code') !== 'google-good-code') return json(400, { error: 'invalid_grant', error_description: 'Malformed auth code. leaked-provider-text' });
        const verifier = body.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
        if (!this.expectedGoogleChallenge || challenge !== this.expectedGoogleChallenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        return json(200, { access_token: `ya29.e2e-access-${n}`, refresh_token: `1//e2e-google-refresh-${n}`, expires_in: 3599, token_type: 'Bearer' });
      }
      if (body.get('grant_type') === 'refresh_token') {
        if (this.googleRefreshRevoked) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        return json(200, { access_token: `ya29.e2e-refreshed-${n}`, expires_in: 3599 });
      }
    }
    if (url.hostname === 'googleads.googleapis.com' && url.pathname.endsWith('/customers:listAccessibleCustomers')) {
      if (headers['developer-token'] !== GOOGLE_DEV_TOKEN || !headers.authorization?.startsWith('Bearer ya29.')) return json(401, { error: { code: 401 } });
      return json(200, { resourceNames: [`customers/${this.ids.customer}`] });
    }
    if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith('/oauth/access_token') && method === 'GET') {
      if (url.searchParams.get('client_secret') !== META_SECRET) return json(400, { error: { code: 1, message: 'bad client' } });
      if (url.searchParams.get('code') === 'meta-good-code') return json(200, { access_token: `EAAB-e2e-short-${n}`, token_type: 'bearer', expires_in: 3600 });
      if (url.searchParams.get('grant_type') === 'fb_exchange_token') {
        if (url.searchParams.get('fb_exchange_token') === 'EAAB-e2e-dead-token') return json(400, { error: { code: 190, message: 'Error validating access token' } });
        return json(200, { access_token: `EAAB-e2e-long-${n}`, token_type: 'bearer', expires_in: 60 * 24 * 3600 });
      }
      return json(400, { error: { code: 100, message: 'Invalid verification code format.' } });
    }
    if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith('/me/adaccounts')) {
      return json(200, { data: [{ account_id: this.ids.adAccount, id: `act_${this.ids.adAccount}` }] });
    }
    if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith('/me/accounts')) {
      return json(200, {
        data: [{ id: this.ids.page, name: 'M4a E2E Page', access_token: `EAAB-e2e-page-token-${n}`, instagram_business_account: { id: this.ids.instagram, username: 'm4a_e2e' } }],
      });
    }
    if (url.hostname === 'www.linkedin.com' && url.pathname === '/oauth/v2/accessToken' && method === 'POST') {
      if (body.get('client_secret') !== LINKEDIN_SECRET) return json(401, { error: 'invalid_client' });
      if (body.get('grant_type') === 'refresh_token' && this.linkedinDown) return json(503, { message: 'unavailable' });
      return json(200, { access_token: `AQV-e2e-li-access-${n}`, expires_in: 60 * 24 * 3600, refresh_token: `AQX-e2e-li-refresh-${n}`, refresh_token_expires_in: 365 * 24 * 3600 });
    }
    if (url.hostname === 'api.linkedin.com' && url.pathname === '/rest/organizationAcls') {
      return json(200, { elements: [{ organization: `urn:li:organization:${this.ids.org}`, role: 'ADMINISTRATOR', state: 'APPROVED' }] });
    }
    if (url.hostname === 'api.linkedin.com' && url.pathname === `/rest/organizations/${this.ids.org}`) {
      return json(200, { id: Number(this.ids.org), localizedName: 'M4a E2E Org' });
    }
    this.unexpected.push(`${method} ${url.hostname}${url.pathname}`);
    return json(404, { error: 'not_found' });
  }
}

describe('OAuth connect (M4a) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let cipher: CredentialCipher;
  let refresh: OAuthRefreshService;
  let fetchSpy: jest.SpyInstance;
  const startedAt = new Date();
  const runId = String(randomInt(1_000_000, 9_999_999));
  const ids = { customer: `8${runId.padStart(9, '0')}`, adAccount: `77${runId}`, page: `78${runId}`, instagram: `79${runId}`, org: `76${runId}` };
  const fake = new FakeProviders(ids);

  let PLATFORM: string;
  let ZEN: string;
  let superAdminToken: string;
  let marketingToken: string;
  let marketing2Token: string;
  let zenOwnerToken: string;
  let marketingUserId: string;
  let previousMfaPolicy: boolean | undefined;
  let previousOAuthClients: Prisma.JsonValue | undefined;
  let settingsRowExisted = false;
  const marketingPhone = normalizePhone(`0536${runId}`)!;
  const marketing2Phone = normalizePhone(`0537${runId}`)!;
  const createdUserPhones = [marketingPhone, marketing2Phone];

  let googleConnectionId: string;
  let metaAdConnectionId: string;
  let pageConnectionId: string;
  let linkedinConnectionId: string;
  let pastedSocialId: string;
  let zenConnectionId: string;

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(server).patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`),
  });
  const login = async (phone: string): Promise<string> => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const hub = async (token = superAdminToken) => {
    const res = await as(token).get('/platform/integrations');
    expect(res.status).toBe(200);
    return res.body as IntegrationHubDTO;
  };
  const start = (token: string, provider: string, body: object) => as(token).post(`/platform/integrations/oauth/${provider}/start`).send(body);
  const startOk = async (token: string, provider: string, body: object) => {
    const res = await start(token, provider, body);
    expect(res.status).toBe(200);
    const out = res.body as OAuthStartResultDTO;
    const authorize = new URL(out.authorizeUrl);
    return { authorize, state: authorize.searchParams.get('state') ?? '' };
  };
  const callback = (provider: string, query: Record<string, string>) => request(server).get(`/platform/integrations/oauth/${provider}/callback`).query(query);
  const hubUrl = (path: 'pazarlama' | 'admin', query: string) => `${APP_ORIGIN}${path === 'admin' ? '/admin/entegrasyonlar' : '/pazarlama/entegrasyonlar'}?${query}`;
  const decrypt = (value: string | null) => (value ? cipher.decrypt(value) : null);

  async function cleanup(): Promise<void> {
    await prisma.socialConnection.deleteMany({ where: { externalId: { in: [ids.page, ids.instagram, ids.org, `75${runId}`] } } });
    await prisma.adConnection.deleteMany({ where: { label: { startsWith: LABEL } } });
    await prisma.oauthState.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.auditLog.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ action: { startsWith: 'integration.oauth.' } }, { action: { startsWith: 'integration.social.' } }, { action: { startsWith: 'ad_connection.' } }] } });
    const users = await prisma.user.findMany({ where: { phone: { in: createdUserPhones } }, select: { id: true } });
    const uids = users.map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: uids } } });
    await prisma.platformMembership.deleteMany({ where: { userId: { in: uids } } });
    await prisma.membership.deleteMany({ where: { userId: { in: uids } } });
    await prisma.user.deleteMany({ where: { id: { in: uids } } });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    cipher = app.get(CredentialCipher);
    refresh = app.get(OAuthRefreshService);

    const realFetch = globalThis.fetch;
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
      return fake.handle(url, init?.method ?? 'GET', typeof init?.body === 'string' ? init.body : '', headers);
    });

    PLATFORM = (await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } })).id;
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    const settings = await prisma.platformIntegrationSettings.findUnique({ where: { id: 'platform' } });
    settingsRowExisted = settings !== null;
    previousOAuthClients = settings?.oauthClients;
    if (settings) await prisma.platformIntegrationSettings.update({ where: { id: 'platform' }, data: { oauthClients: {} } });
    await cleanup();

    const previous = await prisma.platformAccessSettings.findUnique({ where: { id: 'platform' } });
    previousMfaPolicy = previous?.require2faForPlatformRoles;
    await prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', require2faForPlatformRoles: false }, update: { require2faForPlatformRoles: false } });
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
    const role = await prisma.platformRoleTemplate.findUniqueOrThrow({ where: { key: 'marketing_admin' } });
    const m1 = await prisma.user.create({ data: { phone: marketingPhone, firstName: 'Pazarlama', lastName: MARKER, passwordHash, phoneVerifiedAt: new Date() } });
    const m2 = await prisma.user.create({ data: { phone: marketing2Phone, firstName: 'Pazarlama2', lastName: MARKER, passwordHash, phoneVerifiedAt: new Date() } });
    marketingUserId = m1.id;
    for (const u of [m1, m2]) await prisma.platformMembership.create({ data: { userId: u.id, roleTemplateId: role.id, status: 'ACTIVE', activatedAt: new Date() } });

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    marketingToken = await login(marketingPhone);
    marketing2Token = await login(marketing2Phone);
    zenOwnerToken = await login(ZEN_OWNER_PHONE);
  });

  afterAll(async () => {
    fetchSpy?.mockRestore();
    await cleanup();
    if (settingsRowExisted) await prisma.platformIntegrationSettings.update({ where: { id: 'platform' }, data: { oauthClients: (previousOAuthClients ?? {}) as Prisma.InputJsonValue } });
    else await prisma.platformIntegrationSettings.deleteMany({ where: { id: 'platform' } });
    if (previousMfaPolicy !== undefined) await prisma.platformAccessSettings.update({ where: { id: 'platform' }, data: { require2faForPlatformRoles: previousMfaPolicy } });
    await prisma.$disconnect();
    await app.close();
    if (previousEncryptionKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = previousEncryptionKey;
  });

  // ---------------------------------------------------------------------------
  // Client settings
  // ---------------------------------------------------------------------------

  describe('client settings (super admin only)', () => {
    it('refuses everyone but the super admin', async () => {
      const body = { clientId: 'google-client-id.apps', clientSecret: GOOGLE_SECRET, developerToken: GOOGLE_DEV_TOKEN };
      expect((await as(marketingToken).put('/admin/integrations/oauth/google').send(body)).status).toBe(403);
      expect((await as(zenOwnerToken).put('/admin/integrations/oauth/google').send(body)).status).toBe(403);
      expect((await request(server).put('/admin/integrations/oauth/google').send(body)).status).toBe(401);
      expect((await as(marketingToken).get('/admin/integrations/oauth')).status).toBe(403);
    });

    it('validates the provider fields and stores only masked metadata next to ciphertext', async () => {
      expect((await as(superAdminToken).put('/admin/integrations/oauth/google').send({ clientId: 'google-client-id.apps', clientSecret: GOOGLE_SECRET })).status).toBe(400);
      expect((await as(superAdminToken).put('/admin/integrations/oauth/tiktok').send({ clientId: 'x-client' })).status).toBe(400);
      expect((await as(superAdminToken).put('/admin/integrations/oauth/linkedin').send({ clientId: 'li-client', clientSecret: LINKEDIN_SECRET, scopes: ['openid'] })).status).toBe(400);

      const google = await as(superAdminToken).put('/admin/integrations/oauth/google').send({ clientId: 'google-client-id.apps', clientSecret: GOOGLE_SECRET, developerToken: GOOGLE_DEV_TOKEN });
      expect(google.status).toBe(200);
      expect(google.body).toMatchObject({ provider: 'GOOGLE', configured: true, clientSecretPreview: `****${GOOGLE_SECRET.slice(-4)}`, developerTokenPreview: `****${GOOGLE_DEV_TOKEN.slice(-4)}` });
      const meta = await as(superAdminToken).put('/admin/integrations/oauth/meta').send({ clientId: '1234567890123', clientSecret: META_SECRET });
      expect(meta.status).toBe(200);

      const list = await as(superAdminToken).get('/admin/integrations/oauth');
      const text = JSON.stringify(list.body);
      for (const secret of [GOOGLE_SECRET, GOOGLE_DEV_TOKEN, META_SECRET, 'google-client-id.apps']) expect(text).not.toContain(secret);
      expect((list.body as OAuthClientSettingsDTO[]).map((c) => [c.provider, c.configured])).toEqual([
        ['META', true],
        ['GOOGLE', true],
        ['LINKEDIN', false],
      ]);
      const row = await prisma.platformIntegrationSettings.findUniqueOrThrow({ where: { id: 'platform' } });
      const stored = JSON.stringify(row.oauthClients);
      for (const secret of [GOOGLE_SECRET, GOOGLE_DEV_TOKEN, META_SECRET, 'google-client-id.apps']) expect(stored).not.toContain(secret);
      expect(await prisma.auditLog.count({ where: { action: 'integration.oauth.client_set', createdAt: { gte: startedAt } } })).toBe(2);
    });

    it('keeps the stored secret when only the client id or scopes change', async () => {
      const res = await as(superAdminToken).put('/admin/integrations/oauth/meta').send({ clientId: '1234567890123', scopes: ['pages_show_list', 'pages_manage_posts', 'ads_read'] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ configured: true, clientSecretPreview: `****${META_SECRET.slice(-4)}`, scopes: ['pages_show_list', 'pages_manage_posts', 'ads_read'] });
    });

    it('the hub shows provider readiness and the redirect URI to everyone, the client settings only to the super admin', async () => {
      const admin = await hub();
      expect(admin.oauth.providers.map((p) => [p.provider, p.configured])).toEqual([
        ['META', true],
        ['GOOGLE', true],
        ['LINKEDIN', false],
      ]);
      expect(admin.oauth.providers.find((p) => p.provider === 'GOOGLE')?.redirectUri).toMatch(/\/platform\/integrations\/oauth\/google\/callback$/);
      expect(admin.oauth.clients).toHaveLength(3);
      const member = await hub(marketingToken);
      expect(member.oauth.clients).toBeNull();
      expect(JSON.stringify(member)).not.toContain(GOOGLE_SECRET);
    });
  });

  // ---------------------------------------------------------------------------
  // Start and callback
  // ---------------------------------------------------------------------------

  describe('start', () => {
    it('is refused to tenant owners and anonymous callers', async () => {
      const body = { target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'META_PAGE', externalId: ids.page } };
      expect((await start(zenOwnerToken, 'meta', body)).status).toBe(403);
      expect((await request(server).post('/platform/integrations/oauth/meta/start').send(body)).status).toBe(401);
    });

    it('validates the provider, its client settings and the target', async () => {
      expect((await start(superAdminToken, 'tiktok', { target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'META_PAGE', externalId: '1' } })).status).toBe(400);
      const notConfigured = await start(superAdminToken, 'linkedin', { target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'LINKEDIN_ORG', externalId: ids.org } });
      expect(notConfigured.status).toBe(409);
      expect(notConfigured.body.code).toBe('OAUTH_PROVIDER_NOT_CONFIGURED');
      const wrongTarget = await start(superAdminToken, 'google', { target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'META_PAGE', externalId: '1' } });
      expect(wrongTarget.status).toBe(400);
      expect(wrongTarget.body.code).toBe('OAUTH_TARGET_INVALID');
      expect((await start(superAdminToken, 'meta', { target: { kind: 'NEW_AD_CONNECTION', label: `${LABEL} x`, externalAccountId: 'act_1' } })).body.code).toBe('OAUTH_TARGET_INVALID');
      expect((await start(superAdminToken, 'meta', { target: { kind: 'NEW_AD_CONNECTION', label: 'x', externalAccountId: 'act_1', pixelId: '12345', accessToken: 'EAAB' } })).status).toBe(400);
      expect((await start(superAdminToken, 'meta', { target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'META_PAGE', externalId: '1' }, returnTo: 'https://evil.example' })).status).toBe(400);
    });

    it('stores a hashed, bound, 10 minute state and returns the Google consent URL with PKCE, offline access and consent', async () => {
      const { authorize, state } = await startOk(marketingToken, 'google', {
        target: { kind: 'NEW_AD_CONNECTION', label: `${LABEL} google`, externalAccountId: ids.customer, conversionId: 'AW-123456' },
      });
      expect(`${authorize.origin}${authorize.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
        client_id: 'google-client-id.apps',
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/adwords',
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
      });
      expect(authorize.searchParams.get('redirect_uri')).toMatch(/\/platform\/integrations\/oauth\/google\/callback$/);
      expect(authorize.toString()).not.toContain(GOOGLE_SECRET);

      const row = await prisma.oauthState.findUniqueOrThrow({ where: { stateHash: hashOAuthState(state) } });
      expect(row).toMatchObject({ studioId: PLATFORM, userId: marketingUserId, provider: 'GOOGLE', targetKind: 'NEW_AD_CONNECTION', returnTo: 'marketing', usedAt: null });
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(9 * MINUTE);
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(10 * MINUTE + 1000);
      expect(JSON.stringify(row)).not.toContain(state);
      expect(row.encryptedCodeVerifier).not.toBeNull();
      expect(row.encryptedCodeVerifier?.startsWith('plain:')).toBe(false);

      // Callback: the fake Google checks S256(code_verifier) against this challenge.
      fake.expectedGoogleChallenge = authorize.searchParams.get('code_challenge');
      const res = await callback('google', { code: 'google-good-code', state, scope: 'https://www.googleapis.com/auth/adwords' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(hubUrl('pazarlama', 'oauth=ok&provider=google'));
      expect(res.headers['cache-control']).toBe('no-store');

      const conn = await prisma.adConnection.findFirstOrThrow({ where: { studioId: PLATFORM, label: `${LABEL} google` } });
      googleConnectionId = conn.id;
      expect(conn).toMatchObject({ platform: 'GOOGLE', status: 'CONNECTED', authMethod: 'OAUTH', oauthProvider: 'GOOGLE', externalAccountId: ids.customer, connectedByUserId: marketingUserId, refreshAttempts: 0 });
      expect(conn.tokenExpiresAt).toBeNull();
      expect(conn.nextRefreshAt?.getTime()).toBeGreaterThan(Date.now() + 23 * HOUR);
      const text = JSON.stringify(conn);
      expect(text).not.toMatch(/1\/\/e2e-google-refresh/);
      expect(text).not.toContain(GOOGLE_SECRET);
      expect(text).not.toContain(GOOGLE_DEV_TOKEN);
      const credentials = JSON.parse(decrypt(conn.encryptedCredentials) ?? '{}') as Record<string, string>;
      expect(credentials).toMatchObject({ clientId: 'google-client-id.apps', clientSecret: GOOGLE_SECRET, developerToken: GOOGLE_DEV_TOKEN, customerId: ids.customer, loginCustomerId: ids.customer, conversionId: 'AW-123456' });
      expect(credentials.refreshToken).toMatch(/^1\/\/e2e-google-refresh-/);
      expect(decrypt(conn.encryptedRefreshToken)).toBe(credentials.refreshToken);
      expect(await prisma.auditLog.count({ where: { action: 'integration.oauth.connected', entityId: conn.id } })).toBe(1);

      // Used once: a replay is refused and nothing is exchanged again.
      const exchanges = fake.calls.filter((c) => c.host === 'oauth2.googleapis.com').length;
      expect((await callback('google', { code: 'google-good-code', state })).status).toBe(400);
      expect(fake.calls.filter((c) => c.host === 'oauth2.googleapis.com').length).toBe(exchanges);
    });

    it('refuses an expired state and a state of another provider (400, no exchange)', async () => {
      const target = { target: { kind: 'RECONNECT_AD_CONNECTION', connectionId: googleConnectionId } };
      const failedBefore = await prisma.auditLog.count({ where: { action: 'integration.oauth.failed', createdAt: { gte: startedAt } } });
      const expired = await startOk(marketingToken, 'google', target);
      await prisma.oauthState.update({ where: { stateHash: hashOAuthState(expired.state) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const before = fake.calls.length;
      const res = await callback('google', { code: 'google-good-code', state: expired.state });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OAUTH_STATE_INVALID');

      const other = await startOk(marketingToken, 'google', target);
      expect((await callback('meta', { code: 'meta-good-code', state: other.state })).status).toBe(400);
      // The wrong-provider attempt burned the state.
      expect((await callback('google', { code: 'google-good-code', state: other.state })).status).toBe(400);
      expect(fake.calls.length).toBe(before);
      expect((await callback('google', { code: 'x', state: 'not-a-state' })).status).toBe(400);
      // Expired, other provider, then the burned state: three audited refusals; the malformed one is not attributable.
      expect(await prisma.auditLog.count({ where: { action: 'integration.oauth.failed', createdAt: { gte: startedAt } } })).toBe(failedBefore + 3);
    });

    it('a failed code exchange changes nothing and redirects with a neutral error', async () => {
      const count = await prisma.adConnection.count({ where: { studioId: PLATFORM } });
      const { authorize, state } = await startOk(marketingToken, 'google', {
        target: { kind: 'NEW_AD_CONNECTION', label: `${LABEL} tampered`, externalAccountId: ids.customer, conversionId: 'AW-123456' },
        returnTo: 'admin',
      });
      fake.expectedGoogleChallenge = authorize.searchParams.get('code_challenge');
      const res = await callback('google', { code: 'tampered-code', state });
      expect(res.status).toBe(302);
      // A platform member is never sent to the admin panel: the entry point is recorded from the role.
      expect(res.headers.location).toBe(hubUrl('pazarlama', 'oauth=error&provider=google&reason=EXCHANGE_FAILED'));
      expect(res.headers.location).not.toContain('leaked-provider-text');
      expect(await prisma.adConnection.count({ where: { studioId: PLATFORM } })).toBe(count);
      const failed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'integration.oauth.failed', createdAt: { gte: startedAt }, metadata: { path: ['reason'], equals: 'EXCHANGE_FAILED' } } });
      expect(failed.metadata).toMatchObject({ provider: 'GOOGLE', detail: 'invalid_grant' });
      expect(JSON.stringify(failed.metadata)).not.toContain('leaked-provider-text');
      expect(JSON.stringify(failed.metadata)).not.toContain('tampered-code');
    });

    it('a declined consent redirects with DENIED to the admin hub for the super admin', async () => {
      const { state } = await startOk(superAdminToken, 'meta', { target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'META_PAGE', externalId: ids.page }, returnTo: 'admin' });
      const res = await callback('meta', { state, error: 'access_denied', error_reason: 'user_denied', error_description: 'Permissions error' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(hubUrl('admin', 'oauth=error&provider=meta&reason=DENIED'));
    });

    it('Meta: a Facebook Page gets its page token (no expiry) and an ad account a long-lived user token', async () => {
      const page = await startOk(marketingToken, 'meta', { target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'META_PAGE', externalId: ids.page } });
      expect(`${page.authorize.origin}${page.authorize.pathname}`).toBe('https://www.facebook.com/v21.0/dialog/oauth');
      expect(page.authorize.searchParams.get('scope')).toBe('pages_show_list,pages_manage_posts,ads_read');
      expect(page.authorize.searchParams.get('code_challenge')).toBeNull();
      const res = await callback('meta', { code: 'meta-good-code', state: page.state });
      expect(res.headers.location).toBe(hubUrl('pazarlama', 'oauth=ok&provider=meta'));
      const social = await prisma.socialConnection.findFirstOrThrow({ where: { studioId: PLATFORM, provider: 'META_PAGE', externalId: ids.page } });
      pageConnectionId = social.id;
      expect(social).toMatchObject({ status: 'CONNECTED', authMethod: 'OAUTH', oauthProvider: 'META', displayName: 'M4a E2E Page', tokenExpiresAt: null, nextRefreshAt: null, connectedByUserId: marketingUserId });
      expect(social.encryptedCredentials).not.toContain('EAAB');
      expect(JSON.parse(decrypt(social.encryptedCredentials) ?? '{}')).toEqual({ accessToken: expect.stringMatching(/^EAAB-e2e-page-token-/) });
      // The code exchange sent the secret only to graph.facebook.com and swapped the short token for a long-lived one.
      expect(fake.calls.filter((c) => c.host === 'graph.facebook.com' && c.path.endsWith('/oauth/access_token')).map((c) => c.query.get('grant_type') ?? 'code')).toEqual(['code', 'fb_exchange_token']);

      const ad = await startOk(marketingToken, 'meta', { target: { kind: 'NEW_AD_CONNECTION', label: `${LABEL} meta`, externalAccountId: `act_${ids.adAccount}`, pixelId: '770000000000001' } });
      expect((await callback('meta', { code: 'meta-good-code', state: ad.state })).headers.location).toBe(hubUrl('pazarlama', 'oauth=ok&provider=meta'));
      const conn = await prisma.adConnection.findFirstOrThrow({ where: { studioId: PLATFORM, label: `${LABEL} meta` } });
      metaAdConnectionId = conn.id;
      expect(conn).toMatchObject({ platform: 'META', authMethod: 'OAUTH', pixelOrDatasetId: '770000000000001' });
      expect(conn.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * DAY);
      expect(Math.abs(conn.nextRefreshAt!.getTime() - (conn.tokenExpiresAt!.getTime() - DAY))).toBeLessThan(1000);
      expect(JSON.parse(decrypt(conn.encryptedCredentials) ?? '{}')).toMatchObject({ accessToken: expect.stringMatching(/^EAAB-e2e-long-/), pixelId: '770000000000001' });
    });

    it('Meta: an account the person cannot reach is refused without writing anything', async () => {
      const { state } = await startOk(marketingToken, 'meta', { target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'INSTAGRAM', externalId: '1111' } });
      const res = await callback('meta', { code: 'meta-good-code', state });
      expect(res.headers.location).toBe(hubUrl('pazarlama', 'oauth=error&provider=meta&reason=ACCOUNT_NOT_ACCESSIBLE'));
      expect(await prisma.socialConnection.count({ where: { studioId: PLATFORM, externalId: '1111' } })).toBe(0);
    });

    it('LinkedIn: an administered organization with access and refresh tokens', async () => {
      const set = await as(superAdminToken).put('/admin/integrations/oauth/linkedin').send({ clientId: 'li-client-id', clientSecret: LINKEDIN_SECRET, scopes: ['w_organization_social', 'r_organization_social'] });
      expect(set.status).toBe(200);
      const { authorize, state } = await startOk(superAdminToken, 'linkedin', { target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'LINKEDIN_ORG', externalId: ids.org } });
      expect(`${authorize.origin}${authorize.pathname}`).toBe('https://www.linkedin.com/oauth/v2/authorization');
      expect(authorize.searchParams.get('scope')).toBe('w_organization_social r_organization_social');
      const res = await callback('linkedin', { code: 'li-code', state });
      expect(res.headers.location).toBe(hubUrl('pazarlama', 'oauth=ok&provider=linkedin'));
      const social = await prisma.socialConnection.findFirstOrThrow({ where: { studioId: PLATFORM, provider: 'LINKEDIN_ORG', externalId: ids.org } });
      linkedinConnectionId = social.id;
      expect(social).toMatchObject({ authMethod: 'OAUTH', oauthProvider: 'LINKEDIN', displayName: 'M4a E2E Org' });
      expect(social.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * DAY);
      expect(decrypt(social.encryptedRefreshToken)).toMatch(/^AQX-e2e-li-refresh-/);
      expect(JSON.stringify(social)).not.toContain('AQX-e2e');
      expect(JSON.stringify(social)).not.toContain('AQV-e2e');
      const acl = fake.calls.find((c) => c.path === '/rest/organizationAcls');
      expect(acl?.headers['linkedin-version']).toMatch(/^\d{6}$/);
      expect(acl?.headers.authorization).toMatch(/^Bearer AQV-e2e-li-access-/);
    });

    it('only allow-listed hosts were called, secrets only in bodies or Meta\'s documented query', () => {
      expect(fake.unexpected).toEqual([]);
      expect(new Set(fake.calls.map((c) => c.host))).toEqual(new Set(['oauth2.googleapis.com', 'googleads.googleapis.com', 'graph.facebook.com', 'www.linkedin.com', 'api.linkedin.com']));
      for (const call of fake.calls.filter((c) => c.host !== 'graph.facebook.com')) {
        expect(call.query.toString()).not.toContain(GOOGLE_SECRET);
        expect(call.query.toString()).not.toContain(LINKEDIN_SECRET);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Background refresh, hub and reconnect
  // ---------------------------------------------------------------------------

  describe('background refresh', () => {
    it('rotates a soon-expiring Meta token, backs off a transient LinkedIn failure and marks a revoked Google grant REAUTH_REQUIRED', async () => {
      const pasted = await as(marketingToken)
        .post('/platform/integrations/social')
        .send({ provider: 'META_PAGE', externalId: `75${runId}`, credentials: { accessToken: 'EAAB-m4a-pasted-token-0000' } });
      expect(pasted.status).toBe(201);
      pastedSocialId = pasted.body.id as string;
      const pastedBefore = await prisma.socialConnection.findUniqueOrThrow({ where: { id: pastedSocialId } });

      const now = new Date();
      const metaBefore = await prisma.adConnection.update({
        where: { id: metaAdConnectionId },
        data: { tokenExpiresAt: new Date(now.getTime() + 2 * HOUR), nextRefreshAt: new Date(now.getTime() - MINUTE) },
      });
      await prisma.adConnection.update({ where: { id: googleConnectionId }, data: { nextRefreshAt: new Date(now.getTime() - MINUTE) } });
      await prisma.socialConnection.update({ where: { id: linkedinConnectionId }, data: { nextRefreshAt: new Date(now.getTime() - MINUTE) } });
      fake.googleRefreshRevoked = true;
      fake.linkedinDown = true;

      const result = await refresh.processDue(now);
      expect(result).toMatchObject({ refreshed: 1, retrying: 1, reauthRequired: 1 });

      const meta = await prisma.adConnection.findUniqueOrThrow({ where: { id: metaAdConnectionId } });
      const before = JSON.parse(decrypt(metaBefore.encryptedCredentials) ?? '{}') as { accessToken: string };
      const after = JSON.parse(decrypt(meta.encryptedCredentials) ?? '{}') as { accessToken: string; pixelId: string };
      expect(after.accessToken).not.toBe(before.accessToken);
      expect(after.accessToken).toMatch(/^EAAB-e2e-long-/);
      expect(after.pixelId).toBe('770000000000001');
      expect(meta.tokenExpiresAt!.getTime()).toBeGreaterThan(now.getTime() + 59 * DAY);
      expect(meta.credentialLast4).toBe(after.accessToken.slice(-4));
      expect(meta).toMatchObject({ status: 'CONNECTED', refreshAttempts: 0 });

      const google = await prisma.adConnection.findUniqueOrThrow({ where: { id: googleConnectionId } });
      expect(google).toMatchObject({ status: 'REAUTH_REQUIRED', refreshAttempts: 0 });
      // Still scheduled (skipped while REAUTH_REQUIRED), so a row set back to CONNECTED is not forgotten.
      expect(google.nextRefreshAt!.getTime()).toBeGreaterThan(now.getTime() + 23 * HOUR);
      expect(google.lastError).toBe('OAUTH_REAUTH_REQUIRED: invalid_grant');

      const linkedin = await prisma.socialConnection.findUniqueOrThrow({ where: { id: linkedinConnectionId } });
      expect(linkedin).toMatchObject({ status: 'CONNECTED', refreshAttempts: 1, lastError: 'OAUTH_REFRESH_FAILED: http_503' });
      expect(Math.abs(linkedin.nextRefreshAt!.getTime() - (now.getTime() + 15 * MINUTE))).toBeLessThan(1000);

      // Pasted connections are never touched.
      const pastedAfter = await prisma.socialConnection.findUniqueOrThrow({ where: { id: pastedSocialId } });
      expect(pastedAfter.updatedAt.getTime()).toBe(pastedBefore.updatedAt.getTime());
      expect(pastedAfter.authMethod).toBe('PASTED');

      expect(await prisma.auditLog.count({ where: { action: 'integration.oauth.reauth_required', entityId: googleConnectionId } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'integration.oauth.refresh_failed', entityId: linkedinConnectionId } })).toBe(1);
    });

    it('recovers a transient failure on a later run and gives up after the backoff runs out', async () => {
      fake.linkedinDown = false;
      const later = new Date(Date.now() + 20 * MINUTE);
      await refresh.processDue(later);
      const ok = await prisma.socialConnection.findUniqueOrThrow({ where: { id: linkedinConnectionId } });
      expect(ok).toMatchObject({ refreshAttempts: 0, lastError: null, status: 'CONNECTED' });
      expect(decrypt(ok.encryptedRefreshToken)).toMatch(/^AQX-e2e-li-refresh-/);

      fake.linkedinDown = true;
      await prisma.socialConnection.update({ where: { id: linkedinConnectionId }, data: { refreshAttempts: 3, nextRefreshAt: new Date(later.getTime() - MINUTE) } });
      const result = await refresh.processDue(later);
      expect(result.reauthRequired).toBe(1);
      expect((await prisma.socialConnection.findUniqueOrThrow({ where: { id: linkedinConnectionId } })).status).toBe('REAUTH_REQUIRED');
      fake.linkedinDown = false;
    });

    it('marks a Meta token that can no longer be exchanged REAUTH_REQUIRED', async () => {
      const conn = await prisma.adConnection.findUniqueOrThrow({ where: { id: metaAdConnectionId } });
      const creds = JSON.parse(decrypt(conn.encryptedCredentials) ?? '{}') as Record<string, string>;
      await prisma.adConnection.update({
        where: { id: metaAdConnectionId },
        data: { encryptedCredentials: cipher.encrypt(JSON.stringify({ ...creds, accessToken: 'EAAB-e2e-dead-token' })), nextRefreshAt: new Date(Date.now() - MINUTE) },
      });
      await refresh.processDue(new Date());
      const after = await prisma.adConnection.findUniqueOrThrow({ where: { id: metaAdConnectionId } });
      expect(after).toMatchObject({ status: 'REAUTH_REQUIRED', lastError: 'OAUTH_REAUTH_REQUIRED: meta_190' });
    });
  });

  describe('hub and reconnect', () => {
    it('reports the auth method, expiry and reauth state per connection and never a token', async () => {
      const data = await hub(marketingToken);
      const google = data.adConnections.find((a) => a.id === googleConnectionId);
      expect(google).toMatchObject({ authMethod: 'OAUTH', oauthProvider: 'GOOGLE', reauthRequired: true, status: 'REAUTH_REQUIRED' });
      const page = data.socialConnections.find((c) => c.id === pageConnectionId);
      expect(page).toMatchObject({ authMethod: 'OAUTH', oauthProvider: 'META', reauthRequired: false, tokenExpiresAt: null });
      const linkedin = data.socialConnections.find((c) => c.id === linkedinConnectionId);
      expect(linkedin).toMatchObject({ authMethod: 'OAUTH', reauthRequired: true, status: 'REAUTH_REQUIRED', tokenExpiresAt: expect.any(String) });
      const pasted = data.socialConnections.find((c) => c.id === pastedSocialId);
      expect(pasted).toMatchObject({ authMethod: 'PASTED', oauthProvider: null, reauthRequired: false });
      const text = JSON.stringify(data);
      for (const fragment of ['EAAB-e2e', 'ya29.', '1//e2e', 'AQV-e2e', 'AQX-e2e', GOOGLE_SECRET, META_SECRET, LINKEDIN_SECRET, GOOGLE_DEV_TOKEN]) expect(text).not.toContain(fragment);
    });

    it('reconnect restores a REAUTH_REQUIRED connection in place', async () => {
      fake.googleRefreshRevoked = false;
      const { authorize, state } = await startOk(marketingToken, 'google', { target: { kind: 'RECONNECT_AD_CONNECTION', connectionId: googleConnectionId } });
      fake.expectedGoogleChallenge = authorize.searchParams.get('code_challenge');
      const res = await callback('google', { code: 'google-good-code', state });
      expect(res.headers.location).toBe(hubUrl('pazarlama', 'oauth=ok&provider=google'));
      const conn = await prisma.adConnection.findUniqueOrThrow({ where: { id: googleConnectionId } });
      expect(conn).toMatchObject({ status: 'CONNECTED', lastError: null, refreshAttempts: 0, label: `${LABEL} google`, externalAccountId: ids.customer });
      expect((await hub(marketingToken)).adConnections.find((a) => a.id === googleConnectionId)?.reauthRequired).toBe(false);
    });

    it('pasting a token over an OAuth connection turns it back into a pasted one', async () => {
      const res = await as(marketingToken).patch(`/platform/integrations/social/${pageConnectionId}`).send({ credentials: { accessToken: 'EAAB-m4a-pasted-over-oauth' } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ authMethod: 'PASTED', oauthProvider: null, tokenExpiresAt: null });
      const row = await prisma.socialConnection.findUniqueOrThrow({ where: { id: pageConnectionId } });
      expect(row).toMatchObject({ authMethod: 'PASTED', encryptedRefreshToken: null, nextRefreshAt: null });
    });
  });

  // ---------------------------------------------------------------------------
  // Isolation and limits
  // ---------------------------------------------------------------------------

  describe('tenant isolation and rate limits', () => {
    it('another tenant\'s connection can never be the target, and callbacks write only to the platform tenant', async () => {
      const created = await request(server)
        .post(`/studios/${ZEN}/ads/connections`)
        .set('Authorization', `Bearer ${zenOwnerToken}`)
        .set('x-studio-id', ZEN)
        .send({ platform: 'META', label: `${LABEL} zen`, externalAccountId: 'act_1', credentials: { accessToken: 'EAAB-zen-pasted-000', pixelId: '770000000000009' } });
      expect(created.status).toBe(201);
      zenConnectionId = created.body.id as string;
      const res = await start(superAdminToken, 'meta', { target: { kind: 'RECONNECT_AD_CONNECTION', connectionId: zenConnectionId } });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('OAUTH_TARGET_NOT_FOUND');
      const zen = await prisma.adConnection.findUniqueOrThrow({ where: { id: zenConnectionId } });
      expect(zen.authMethod).toBe('PASTED');
      const oauthRows = await prisma.adConnection.findMany({ where: { authMethod: 'OAUTH', label: { startsWith: LABEL } }, select: { studioId: true } });
      expect(oauthRows.every((r) => r.studioId === PLATFORM)).toBe(true);
      expect((await as(zenOwnerToken).get('/platform/integrations')).status).toBe(403);
    });

    it('limits start to 10 per minute per user', async () => {
      const body = { target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'META_PAGE', externalId: ids.page } };
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) statuses.push((await start(marketing2Token, 'meta', body)).status);
      expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
      expect(statuses[10]).toBe(429);
    });

    it('limits the public callback to 60 per minute per IP', async () => {
      let limited = false;
      for (let i = 0; i < 61 && !limited; i += 1) {
        const res = await callback('meta', { state: 'x' });
        if (res.status === 429) limited = true;
        else expect(res.status).toBe(400);
      }
      expect(limited).toBe(true);
    });
  });
});
