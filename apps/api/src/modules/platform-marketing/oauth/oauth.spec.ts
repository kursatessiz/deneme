import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { OauthState } from '@platform/database';
import { AdsHttpClient } from '../../ads/ads-http-client';
import type { CredentialCipher } from '../../../common/crypto/credential-cipher';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OAuthClientSettingsService, ResolvedOAuthClient } from './oauth-client-settings.service';
import { OAuthConnectService } from './oauth-connect.service';
import { codeChallengeS256, constantTimeEqualHex, generateCodeVerifier, generateOAuthState, hashOAuthState, maskSecret, redactSecrets, sanitizeProviderCode } from './oauth-crypto';
import { OAuthCallError, OAuthProviderClient, classifyOAuthFailure } from './oauth-provider.client';
import { buildOAuthReturnUrl, isAllowedReturnUrl, safeOrigin } from './oauth-redirect';

describe('PKCE and state helpers', () => {
  it('computes the RFC 7636 appendix B S256 challenge', () => {
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generates 43-character base64url verifiers and states that differ every time', () => {
    const values = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const v = generateCodeVerifier();
      const s = generateOAuthState();
      expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
      values.add(v).add(s);
    }
    expect(values.size).toBe(100);
  });

  it('stores only a SHA-256 of the state and compares digests in constant time', () => {
    const state = generateOAuthState();
    const hash = hashOAuthState(state);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(state);
    expect(constantTimeEqualHex(hash, hashOAuthState(state))).toBe(true);
    expect(constantTimeEqualHex(hash, hashOAuthState(`${state}x`))).toBe(false);
    expect(constantTimeEqualHex(hash, hash.slice(0, 62))).toBe(false);
    expect(constantTimeEqualHex('', '')).toBe(false);
    expect(constantTimeEqualHex('zz', 'zz')).toBe(false);
  });
});

describe('token masking', () => {
  it('shows at most the last four characters', () => {
    expect(maskSecret('EAAB-very-secret-token-1234')).toBe('****1234');
    expect(maskSecret(null)).toBeNull();
  });

  it('redacts known secrets and keeps only safe provider codes', () => {
    expect(redactSecrets('bad token EAAB-secret-9999 for client s3cr3t-value', ['EAAB-secret-9999', 's3cr3t-value', null])).toBe('bad token [redacted] for client [redacted]');
    expect(sanitizeProviderCode('invalid_grant')).toBe('invalid_grant');
    expect(sanitizeProviderCode(190)).toBe('190');
    expect(sanitizeProviderCode('Bad Request: token EAAB xyz')).toBe('unknown');
    expect(sanitizeProviderCode('<script>')).toBe('unknown');
    expect(sanitizeProviderCode({ message: 'x' })).toBe('unknown');
  });
});

describe('redirect allow-list', () => {
  const base = 'https://app.example.com';

  it('builds only fixed hub URLs on the configured origin', () => {
    expect(buildOAuthReturnUrl(base, 'marketing', { ok: true, provider: 'GOOGLE' })).toBe('https://app.example.com/pazarlama/entegrasyonlar?oauth=ok&provider=google');
    expect(buildOAuthReturnUrl(`${base}/some/path?x=1`, 'admin', { ok: false, provider: 'META', reason: 'DENIED' })).toBe(
      'https://app.example.com/admin/entegrasyonlar?oauth=error&provider=meta&reason=DENIED',
    );
    // Anything but 'admin' goes to the marketing hub: the stored value can never pick a path.
    expect(buildOAuthReturnUrl(base, '//evil.example/x', { ok: true, provider: 'LINKEDIN' })).toBe('https://app.example.com/pazarlama/entegrasyonlar?oauth=ok&provider=linkedin');
  });

  it('refuses a base that is not an http(s) origin', () => {
    expect(() => buildOAuthReturnUrl('javascript:alert(1)', 'marketing', { ok: true, provider: 'META' })).toThrow();
    expect(safeOrigin('https://user:pw@app.example.com')).toBeNull();
    expect(safeOrigin('not a url')).toBeNull();
  });

  it('accepts only the two hub paths on the same origin', () => {
    expect(isAllowedReturnUrl(base, 'https://app.example.com/admin/entegrasyonlar?oauth=ok&provider=meta')).toBe(true);
    expect(isAllowedReturnUrl(base, 'https://evil.example/pazarlama/entegrasyonlar')).toBe(false);
    expect(isAllowedReturnUrl(base, 'https://app.example.com.evil.example/pazarlama/entegrasyonlar')).toBe(false);
    expect(isAllowedReturnUrl(base, 'https://app.example.com/pazarlama')).toBe(false);
    expect(isAllowedReturnUrl(base, 'https://app.example.com/pazarlama/entegrasyonlar#x')).toBe(false);
    expect(isAllowedReturnUrl(base, '//evil.example/pazarlama/entegrasyonlar')).toBe(false);
  });
});

describe('provider failure classification', () => {
  const res = (status: number, body: unknown) => ({ status, body });
  it('retries network-like failures and asks for a reconnect on grant errors', () => {
    expect(classifyOAuthFailure(res(503, null))).toMatchObject({ kind: 'TRANSIENT', code: 'http_503' });
    expect(classifyOAuthFailure(res(429, { error: 'rate_limited' }))).toMatchObject({ kind: 'TRANSIENT' });
    expect(classifyOAuthFailure(res(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }))).toMatchObject({ kind: 'PERMANENT', code: 'invalid_grant' });
    expect(classifyOAuthFailure(res(400, { error: { code: 190, message: 'Error validating access token: EAAB...' } }))).toMatchObject({ kind: 'PERMANENT', code: 'meta_190' });
    expect(classifyOAuthFailure(res(400, { error: { code: 17, message: 'User request limit reached' } }))).toMatchObject({ kind: 'TRANSIENT', code: 'meta_17' });
    expect(classifyOAuthFailure(res(401, 'plain text with token abc'))).toMatchObject({ kind: 'PERMANENT', code: 'http_401' });
  });

  it('never puts provider text in the error message', () => {
    const err = classifyOAuthFailure(res(400, { error: 'invalid_request', error_description: 'secret-in-description' }));
    expect(err.message).not.toContain('secret-in-description');
  });
});

describe('allow-listed HTTP client with OAuth scopes', () => {
  const http = new AdsHttpClient();
  it('refuses any host outside the provider list before sending', async () => {
    await expect(http.postForm('oauth:GOOGLE', 'https://evil.example/token', {}, { a: 'b' })).rejects.toThrow('izin verilmeyen host');
    await expect(http.getJson('oauth:META', 'https://graph.facebook.com.evil.example/me', {})).rejects.toThrow('izin verilmeyen host');
    await expect(http.getJson('oauth:LINKEDIN', 'https://graph.facebook.com/me', {})).rejects.toThrow('izin verilmeyen host');
  });

  it('maps an allow-list refusal to a permanent failure and a network error to a transient one', async () => {
    const refused = { postForm: async () => Promise.reject(new Error('Reklam platformu için izin verilmeyen host: evil.example')) } as unknown as AdsHttpClient;
    await expect(new OAuthProviderClient(refused).refreshGrant('GOOGLE', { clientId: 'a', clientSecret: 'b' }, 'r')).rejects.toMatchObject({ kind: 'PERMANENT', code: 'host_not_allowed' });
    const failing = { postForm: async () => Promise.reject(new TypeError('fetch failed')) } as unknown as AdsHttpClient;
    await expect(new OAuthProviderClient(failing).refreshGrant('GOOGLE', { clientId: 'a', clientSecret: 'b' }, 'r')).rejects.toMatchObject({ kind: 'TRANSIENT', code: 'network' });
  });
});

// ---------------------------------------------------------------------------
// Callback state machine, with an in-memory stand-in for the two tables it touches
// ---------------------------------------------------------------------------

describe('callback state machine', () => {
  const now = Date.now();
  const STATE = generateOAuthState();
  let rows: OauthState[];
  let audits: Array<{ action: string; metadata: Record<string, unknown> }>;
  let adWrites: number;
  let exchange: jest.Mock<Promise<unknown>, unknown[]>;

  const row = (over: Partial<OauthState> = {}): OauthState => ({
    id: 'state-row-1',
    studioId: 'studio-1',
    userId: 'user-1',
    provider: 'GOOGLE',
    stateHash: hashOAuthState(STATE),
    encryptedCodeVerifier: 'plain:dmVyaWZpZXI=',
    targetKind: 'NEW_AD_CONNECTION',
    targetId: null,
    targetParams: { kind: 'NEW_AD_CONNECTION', label: 'G', externalAccountId: '1234567890', conversionId: 'AW-1' },
    returnTo: 'marketing',
    expiresAt: new Date(now + 5 * 60_000),
    usedAt: null,
    createdAt: new Date(now - 60_000),
    ...over,
  });

  const prisma = {
    oauthState: {
      findUnique: async ({ where }: { where: { stateHash: string } }) => rows.find((r) => r.stateHash === where.stateHash) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; usedAt: null; expiresAt: { gt: Date } }; data: { usedAt: Date } }) => {
        const r = rows.find((x) => x.id === where.id && x.usedAt === null && x.expiresAt > where.expiresAt.gt);
        if (!r) return { count: 0 };
        r.usedAt = data.usedAt;
        return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }: { data: { action: string; metadata: Record<string, unknown> } }) => audits.push({ action: data.action, metadata: data.metadata }) },
    adConnection: {
      create: async () => {
        adWrites += 1;
        return { id: 'ad-1' };
      },
      update: async () => {
        adWrites += 1;
      },
      findFirst: async () => null,
    },
  };
  const config = { get: (key: string, fallback?: string) => ({ PUBLIC_APP_URL: 'https://app.example.com', PUBLIC_API_URL: 'https://api.example.com' })[key] ?? fallback } as unknown as ConfigService;
  const cipher = { encrypt: (v: string) => `plain:${Buffer.from(v).toString('base64')}`, decrypt: (v: string) => Buffer.from(v.slice(6), 'base64').toString('utf8'), isConfigured: false } as unknown as CredentialCipher;
  const client: ResolvedOAuthClient = { clientId: 'cid', clientSecret: 'csecret', configId: null, developerToken: 'dev-token-123', scopes: ['https://www.googleapis.com/auth/adwords'] };
  const clients = { resolve: async () => client } as unknown as OAuthClientSettingsService;

  const service = () => {
    const providers = { exchangeCode: exchange, googleAccessibleCustomers: async () => ['1234567890'] } as unknown as OAuthProviderClient;
    return new OAuthConnectService(prisma as unknown as PrismaService, config, cipher, clients, providers);
  };

  beforeEach(() => {
    rows = [row()];
    audits = [];
    adWrites = 0;
    exchange = jest.fn(async () => ({ accessToken: 'ya29.access', refreshToken: '1//refresh-token', expiresInSec: 3599, refreshExpiresInSec: null }));
  });

  it('unknown state: 400, nothing written', async () => {
    await expect(service().callback('GOOGLE', { state: generateOAuthState(), code: 'c' })).rejects.toBeInstanceOf(BadRequestException);
    expect(audits).toEqual([]);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('valid state: exchanged once with the stored verifier, connection written, redirect ok; a replay is 400', async () => {
    const url = await service().callback('GOOGLE', { state: STATE, code: 'auth-code' });
    expect(url).toBe('https://app.example.com/pazarlama/entegrasyonlar?oauth=ok&provider=google');
    expect(exchange).toHaveBeenCalledWith('GOOGLE', client, { code: 'auth-code', redirectUri: 'https://api.example.com/platform/integrations/oauth/google/callback', codeVerifier: 'verifier' });
    expect(adWrites).toBe(1);
    expect(audits.map((a) => a.action)).toEqual(['integration.oauth.connected']);
    await expect(service().callback('GOOGLE', { state: STATE, code: 'auth-code' })).rejects.toBeInstanceOf(BadRequestException);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(audits[1]).toMatchObject({ action: 'integration.oauth.failed', metadata: { reason: 'STATE_INVALID', detail: 'state_reused' } });
  });

  it('expired state: 400 and no exchange', async () => {
    rows = [row({ expiresAt: new Date(now - 1000) })];
    await expect(service().callback('GOOGLE', { state: STATE, code: 'c' })).rejects.toBeInstanceOf(BadRequestException);
    expect(exchange).not.toHaveBeenCalled();
    expect(audits[0]).toMatchObject({ metadata: { detail: 'state_expired' } });
  });

  it('other provider: 400, the state is burned', async () => {
    await expect(service().callback('META', { state: STATE, code: 'c' })).rejects.toBeInstanceOf(BadRequestException);
    expect(rows[0].usedAt).not.toBeNull();
    expect(exchange).not.toHaveBeenCalled();
    await expect(service().callback('GOOGLE', { state: STATE, code: 'c' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('declined consent: redirect with DENIED, no exchange, no connection', async () => {
    const url = await service().callback('GOOGLE', { state: STATE, error: 'access_denied' });
    expect(url).toBe('https://app.example.com/pazarlama/entegrasyonlar?oauth=error&provider=google&reason=DENIED');
    expect(exchange).not.toHaveBeenCalled();
    expect(adWrites).toBe(0);
  });

  it('failed exchange: redirect with EXCHANGE_FAILED, nothing written, audit keeps only the sanitized code', async () => {
    exchange.mockRejectedValueOnce(new OAuthCallError('PERMANENT', 'invalid_grant'));
    const url = await service().callback('GOOGLE', { state: STATE, code: 'tampered' });
    expect(url).toContain('reason=EXCHANGE_FAILED');
    expect(adWrites).toBe(0);
    expect(audits).toEqual([{ action: 'integration.oauth.failed', metadata: expect.objectContaining({ reason: 'EXCHANGE_FAILED', detail: 'invalid_grant' }) }]);
    expect(JSON.stringify(audits)).not.toContain('tampered');
  });

  it('a Google grant without a refresh token is refused', async () => {
    exchange.mockResolvedValueOnce({ accessToken: 'ya29.access', refreshToken: null, expiresInSec: 3599, refreshExpiresInSec: null });
    const url = await service().callback('GOOGLE', { state: STATE, code: 'c' });
    expect(url).toContain('reason=MISSING_REFRESH_TOKEN');
    expect(adWrites).toBe(0);
  });
});
