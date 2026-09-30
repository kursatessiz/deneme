import {
  OAUTH_AUTHORIZE_HOSTS,
  OAUTH_PROVIDERS,
  OAUTH_PROVIDER_ALLOWED_HOSTS,
  OAUTH_PROVIDER_DEFINITIONS,
  OAUTH_REFRESH_BACKOFF_MINUTES,
  OAUTH_RESULT_REASONS,
  OAUTH_RETURN_PATHS,
  OAuthCallbackQuerySchema,
  SetOAuthClientSchema,
  StartOAuthSchema,
  isExpectedAuthorizeUrl,
  oauthClientIssues,
  oauthNextRefreshAt,
  oauthProviderForAdPlatform,
  oauthProviderForSocial,
  oauthProviderFromSlug,
  oauthRefreshRetryDelayMs,
  oauthTargetIssues,
  parseOAuthLanding,
} from './oauth';
import { AD_CONNECTION_STATUSES } from '../growth/ads';
import { SOCIAL_CONNECTION_STATUSES } from './social';
import { BUNDLED_MESSAGES } from '../i18n';

const HOUR = 60 * 60 * 1000;
const params = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

describe('OAuth provider definitions (data)', () => {
  it('every server-side URL is on the provider allow-list and every URL is https', () => {
    for (const provider of OAUTH_PROVIDERS) {
      const def = OAUTH_PROVIDER_DEFINITIONS[provider];
      for (const url of [def.tokenUrl, def.identityUrl]) {
        expect(url.startsWith('https://')).toBe(true);
        const host = url.slice('https://'.length).split('/')[0];
        expect(OAUTH_PROVIDER_ALLOWED_HOSTS[provider]).toContain(host);
      }
      expect(def.authorizeUrl.startsWith(`https://${OAUTH_AUTHORIZE_HOSTS[provider]}/`)).toBe(true);
      expect(def.defaultScopes.every((s) => def.allowedScopes.includes(s))).toBe(true);
    }
  });

  it('allow-lists exactly the documented hosts', () => {
    expect(OAUTH_PROVIDER_ALLOWED_HOSTS.META).toEqual(['graph.facebook.com']);
    expect(OAUTH_PROVIDER_ALLOWED_HOSTS.GOOGLE).toEqual(['oauth2.googleapis.com', 'accounts.google.com', 'googleads.googleapis.com']);
    expect(OAUTH_PROVIDER_ALLOWED_HOSTS.LINKEDIN).toEqual(['www.linkedin.com', 'api.linkedin.com']);
  });

  it('Google asks for offline access with consent and uses PKCE; Meta and LinkedIn do not send PKCE', () => {
    expect(OAUTH_PROVIDER_DEFINITIONS.GOOGLE.extraAuthorizeParams).toEqual({ access_type: 'offline', prompt: 'consent' });
    expect(OAUTH_PROVIDER_DEFINITIONS.GOOGLE.pkce).toBe(true);
    expect(OAUTH_PROVIDER_DEFINITIONS.META.pkce).toBe(false);
    expect(OAUTH_PROVIDER_DEFINITIONS.LINKEDIN.pkce).toBe(false);
    expect(OAUTH_PROVIDER_DEFINITIONS.LINKEDIN.defaultScopes).toContain('w_organization_social');
    expect(OAUTH_PROVIDER_DEFINITIONS.META.defaultScopes).toEqual(expect.arrayContaining(['ads_management', 'pages_manage_posts', 'instagram_content_publish', 'leads_retrieval']));
  });

  it('maps slugs, ad platforms and social providers to providers', () => {
    expect(oauthProviderFromSlug('meta')).toBe('META');
    expect(oauthProviderFromSlug('META')).toBeNull();
    expect(oauthProviderFromSlug('tiktok')).toBeNull();
    expect(oauthProviderForAdPlatform('GOOGLE')).toBe('GOOGLE');
    expect(oauthProviderForAdPlatform('TIKTOK')).toBeNull();
    expect(oauthProviderForSocial('INSTAGRAM')).toBe('META');
    expect(oauthProviderForSocial('LINKEDIN_ORG')).toBe('LINKEDIN');
  });

  it('adds REAUTH_REQUIRED to both connection status lists', () => {
    expect(AD_CONNECTION_STATUSES).toContain('REAUTH_REQUIRED');
    expect(SOCIAL_CONNECTION_STATUSES).toContain('REAUTH_REQUIRED');
  });
});

describe('isExpectedAuthorizeUrl', () => {
  it('accepts only the provider authorize endpoint with a query', () => {
    expect(isExpectedAuthorizeUrl('GOOGLE', `${OAUTH_PROVIDER_DEFINITIONS.GOOGLE.authorizeUrl}?client_id=x`)).toBe(true);
    expect(isExpectedAuthorizeUrl('GOOGLE', 'https://evil.example/o/oauth2/v2/auth?client_id=x')).toBe(false);
    expect(isExpectedAuthorizeUrl('GOOGLE', `${OAUTH_PROVIDER_DEFINITIONS.META.authorizeUrl}?client_id=x`)).toBe(false);
    expect(isExpectedAuthorizeUrl('META', `${OAUTH_PROVIDER_DEFINITIONS.META.authorizeUrl}.evil.example/?a=1`)).toBe(false);
  });
});

describe('start target validation', () => {
  const parse = (body: unknown) => StartOAuthSchema.safeParse(body);

  it('parses the four target kinds and defaults returnTo to marketing', () => {
    const r = parse({ target: { kind: 'RECONNECT_AD_CONNECTION', connectionId: '6f1c2c6e-7c32-4c8e-9d0c-1a2b3c4d5e6f' } });
    expect(r.success && r.data.returnTo).toBe('marketing');
    expect(parse({ target: { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'META_PAGE', externalId: '123' }, returnTo: 'admin' }).success).toBe(true);
    expect(parse({ target: { kind: 'NEW_AD_CONNECTION', label: 'x', externalAccountId: 'act_1', pixelId: '12345' } }).success).toBe(true);
  });

  it('refuses unknown fields, a bad return target and a secret smuggled into the target', () => {
    expect(parse({ target: { kind: 'NEW_AD_CONNECTION', label: 'x', externalAccountId: 'act_1', accessToken: 'secret' } }).success).toBe(false);
    expect(parse({ target: { kind: 'RECONNECT_AD_CONNECTION', connectionId: 'nope' } }).success).toBe(false);
    expect(parse({ target: { kind: 'RECONNECT_AD_CONNECTION', connectionId: '6f1c2c6e-7c32-4c8e-9d0c-1a2b3c4d5e6f' }, returnTo: 'https://evil.example' }).success).toBe(false);
    expect(parse({ target: { kind: 'NEW_AD_CONNECTION', label: 'x', externalAccountId: '../x' } }).success).toBe(false);
  });

  it('checks the target against the provider', () => {
    expect(oauthTargetIssues('META', { kind: 'NEW_AD_CONNECTION', label: 'x', externalAccountId: 'act_1' })).toEqual(['PIXEL_REQUIRED']);
    expect(oauthTargetIssues('META', { kind: 'NEW_AD_CONNECTION', label: 'x', externalAccountId: 'act_1', pixelId: '12345' })).toEqual([]);
    expect(oauthTargetIssues('GOOGLE', { kind: 'NEW_AD_CONNECTION', label: 'x', externalAccountId: '1234567890', conversionId: 'AW-1' })).toEqual([]);
    expect(oauthTargetIssues('GOOGLE', { kind: 'NEW_AD_CONNECTION', label: 'x', externalAccountId: 'act_1', conversionId: 'AW-1' })).toEqual(['GOOGLE_FIELDS_REQUIRED']);
    expect(oauthTargetIssues('GOOGLE', { kind: 'NEW_AD_CONNECTION', label: 'x', externalAccountId: '1234567890', conversionId: 'AW-1', pixelId: '12345' })).toEqual(['FIELD_NOT_FOR_PROVIDER']);
    expect(oauthTargetIssues('LINKEDIN', { kind: 'NEW_AD_CONNECTION', label: 'x', externalAccountId: '1' })).toEqual(['NO_AD_PLATFORM']);
    expect(oauthTargetIssues('GOOGLE', { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'META_PAGE', externalId: '1' })).toEqual(['SOCIAL_PROVIDER_MISMATCH']);
    expect(oauthTargetIssues('LINKEDIN', { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: 'LINKEDIN_ORG', externalId: '1' })).toEqual([]);
  });
});

describe('callback query', () => {
  const state = 'A'.repeat(43);
  it('needs a 43 character base64url state and drops unknown parameters', () => {
    expect(OAuthCallbackQuerySchema.safeParse({ state, code: 'c', scope: 'x', authuser: '0' })).toEqual({ success: true, data: { state, code: 'c' } });
    expect(OAuthCallbackQuerySchema.safeParse({ state: 'short', code: 'c' }).success).toBe(false);
    expect(OAuthCallbackQuerySchema.safeParse({ state: `${'A'.repeat(42)}=`, code: 'c' }).success).toBe(false);
    expect(OAuthCallbackQuerySchema.safeParse({ state, code: 'c'.repeat(2049) }).success).toBe(false);
  });
});

describe('client settings validation', () => {
  it('needs a secret the first time and keeps the stored one after', () => {
    const input = SetOAuthClientSchema.parse({ clientId: 'client-id-1' });
    expect(oauthClientIssues('META', input, { hasSecret: false, hasDeveloperToken: false })).toEqual(['SECRET_REQUIRED']);
    expect(oauthClientIssues('META', input, { hasSecret: true, hasDeveloperToken: false })).toEqual([]);
  });

  it('requires the Google developer token and refuses fields and scopes of another provider', () => {
    expect(oauthClientIssues('GOOGLE', { clientId: 'client-id-1', clientSecret: 'secret-123' }, { hasSecret: false, hasDeveloperToken: false })).toEqual(['DEVELOPER_TOKEN_REQUIRED']);
    expect(oauthClientIssues('LINKEDIN', { clientId: 'client-id-1', clientSecret: 'secret-123', developerToken: 'dev-token-12345' }, { hasSecret: false, hasDeveloperToken: false })).toEqual(['FIELD_NOT_FOR_PROVIDER']);
    expect(oauthClientIssues('LINKEDIN', { clientId: 'client-id-1', clientSecret: 'secret-123', scopes: ['w_organization_social', 'openid'] }, { hasSecret: false, hasDeveloperToken: false })).toEqual(['SCOPE_NOT_ALLOWED']);
    expect(oauthClientIssues('META', { clientId: 'client-id-1', clientSecret: 'secret-123', configId: '123456789' }, { hasSecret: false, hasDeveloperToken: false })).toEqual([]);
  });

  it('refuses whitespace and control characters in the credentials', () => {
    expect(SetOAuthClientSchema.safeParse({ clientId: 'a b c d' }).success).toBe(false);
    expect(SetOAuthClientSchema.safeParse({ clientId: 'abcd', clientSecret: 'secret\nvalue' }).success).toBe(false);
    expect(SetOAuthClientSchema.safeParse({ clientId: 'abcd', extra: 1 }).success).toBe(false);
  });
});

describe('refresh timing', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('is due 24 hours before expiry, never in the past', () => {
    expect(oauthNextRefreshAt('META', new Date(now.getTime() + 60 * 24 * HOUR), false, now)?.toISOString()).toBe(new Date(now.getTime() + 59 * 24 * HOUR).toISOString());
    expect(oauthNextRefreshAt('LINKEDIN', new Date(now.getTime() + 2 * HOUR), true, now)?.toISOString()).toBe(now.toISOString());
  });

  it('checks a non-expiring Google grant daily and never schedules a non-expiring token otherwise', () => {
    expect(oauthNextRefreshAt('GOOGLE', null, true, now)?.toISOString()).toBe(new Date(now.getTime() + 24 * HOUR).toISOString());
    expect(oauthNextRefreshAt('META', null, false, now)).toBeNull();
    expect(oauthNextRefreshAt('LINKEDIN', null, false, now)).toBeNull();
  });

  it('backs off 15 minutes, 1 hour, 4 hours, then gives up', () => {
    expect(OAUTH_REFRESH_BACKOFF_MINUTES).toEqual([15, 60, 240]);
    expect([1, 2, 3, 4].map(oauthRefreshRetryDelayMs)).toEqual([15 * 60_000, 60 * 60_000, 240 * 60_000, null]);
  });
});

describe('hub landing parameters', () => {
  it('reads ok and error results and never trusts an unknown reason or provider', () => {
    expect(parseOAuthLanding(params({ oauth: 'ok', provider: 'google' }))).toEqual({ ok: true, provider: 'GOOGLE' });
    expect(parseOAuthLanding(params({ oauth: 'error', provider: 'meta', reason: 'DENIED' }))).toEqual({ ok: false, provider: 'META', reason: 'DENIED' });
    expect(parseOAuthLanding(params({ oauth: 'error', provider: 'meta', reason: '<script>' }))).toEqual({ ok: false, provider: 'META', reason: 'INTERNAL' });
    expect(parseOAuthLanding(params({ oauth: 'ok', provider: 'evil' }))).toBeNull();
    expect(parseOAuthLanding(params({ oauth: 'maybe', provider: 'meta' }))).toBeNull();
    expect(parseOAuthLanding(params({}))).toBeNull();
  });

  it('returns only to the two fixed hub paths', () => {
    expect(OAUTH_RETURN_PATHS).toEqual({ marketing: '/pazarlama/entegrasyonlar', admin: '/admin/entegrasyonlar' });
  });

  it('has a Turkish and an English text for every result reason and provider', () => {
    for (const locale of ['tr', 'en'] as const) {
      const messages = BUNDLED_MESSAGES[locale];
      for (const provider of OAUTH_PROVIDERS) expect(messages[`integrationsOAuth.provider.${provider}`]).toEqual(expect.any(String));
      for (const reason of OAUTH_RESULT_REASONS) expect(messages[`integrationsOAuth.reason.${reason}`]).toEqual(expect.any(String));
    }
  });
});
