import { z } from 'zod';
import { GOOGLE_ADS_API_VERSION, GOOGLE_ADS_HOST, GOOGLE_OAUTH_HOST, META_GRAPH_API_VERSION, type AdConnectionPlatform } from '../growth/ads';
import type { IntegrationEntryPoint } from '../integrations-hub';
import { LINKEDIN_API_HOST, META_GRAPH_HOST, SOCIAL_LINKEDIN_API_VERSION, SOCIAL_PROVIDERS, type SocialProvider } from './social';

/**
 * OAuth connect (M4a, docs/PAZARLAMA_MODULU.md 5.2): the super admin enters
 * a client id and secret per provider (stored encrypted in
 * platform_integration_settings), a platform user starts an authorization
 * from the integrations hub, the provider redirects the browser to the API
 * callback with a one-time `state`, and the tokens land encrypted on an
 * AdConnection or SocialConnection. Everything that differs between the
 * providers is data in this file: URLs, scopes, PKCE support, the refresh
 * semantics and the hosts the server may call.
 */

export const OAUTH_PROVIDERS = ['META', 'GOOGLE', 'LINKEDIN'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Lower-case path segment of each provider (`/platform/integrations/oauth/:provider/...`). */
export const OAUTH_PROVIDER_SLUGS = { META: 'meta', GOOGLE: 'google', LINKEDIN: 'linkedin' } as const satisfies Record<OAuthProvider, string>;
export type OAuthProviderSlug = (typeof OAUTH_PROVIDER_SLUGS)[OAuthProvider];

export function oauthProviderFromSlug(slug: string): OAuthProvider | null {
  const found = OAUTH_PROVIDERS.find((p) => OAUTH_PROVIDER_SLUGS[p] === slug);
  return found ?? null;
}

export const OAuthProviderSlugSchema = z.enum(['meta', 'google', 'linkedin']);

/** How the credential of a connection got there: pasted by a person, or through the OAuth flow. */
export const INTEGRATION_AUTH_METHODS = ['PASTED', 'OAUTH'] as const;
export type IntegrationAuthMethod = (typeof INTEGRATION_AUTH_METHODS)[number];

/** Connection status after a refresh failed for good: the hub offers "reconnect". */
export const OAUTH_REAUTH_STATUS = 'REAUTH_REQUIRED' as const;

// ---------------------------------------------------------------------------
// Hosts and provider definitions (data, not code)
// ---------------------------------------------------------------------------

export const META_OAUTH_DIALOG_HOST = 'www.facebook.com';
export const GOOGLE_ACCOUNTS_HOST = 'accounts.google.com';
export const LINKEDIN_WWW_HOST = 'www.linkedin.com';

/**
 * The only hosts the server calls for a provider's token exchange, refresh
 * and identity reads (the allow-listed HTTP client refuses everything else).
 * accounts.google.com is listed because it is Google's OAuth host, although
 * only the browser visits it.
 */
export const OAUTH_PROVIDER_ALLOWED_HOSTS: Readonly<Record<OAuthProvider, readonly string[]>> = {
  META: [META_GRAPH_HOST],
  GOOGLE: [GOOGLE_OAUTH_HOST, GOOGLE_ACCOUNTS_HOST, GOOGLE_ADS_HOST],
  LINKEDIN: [LINKEDIN_WWW_HOST, LINKEDIN_API_HOST],
};

/**
 * REFRESH_TOKEN_GRANT: standard `grant_type=refresh_token` (Google, LinkedIn
 * apps that were granted refresh tokens). META_LONG_LIVED_EXCHANGE: Meta has
 * no refresh token; a still-valid long-lived user token is exchanged
 * (`fb_exchange_token`) for a new one before it expires.
 */
export type OAuthRefreshKind = 'REFRESH_TOKEN_GRANT' | 'META_LONG_LIVED_EXCHANGE';

/** Extra client settings a provider needs besides the id and the secret (stored encrypted). */
export type OAuthClientExtraField = 'configId' | 'developerToken';

export interface OAuthProviderDefinition {
  provider: OAuthProvider;
  /** Where the browser is sent to consent. */
  authorizeUrl: string;
  /** Code exchange and refresh endpoint. */
  tokenUrl: string;
  /** Identity / account list endpoint read after the exchange. */
  identityUrl: string;
  /** Scopes requested when the super admin did not narrow them. */
  defaultScopes: readonly string[];
  /** Every scope the super admin may choose; nothing else is ever requested. */
  allowedScopes: readonly string[];
  scopeSeparator: ' ' | ',';
  /** PKCE (S256) is sent only where the provider documents it for this flow. */
  pkce: boolean;
  /** Fixed extra authorize parameters. */
  extraAuthorizeParams: Readonly<Record<string, string>>;
  refresh: OAuthRefreshKind;
  /** The ad platform a connection of this provider becomes, or null when it has none. */
  adPlatform: AdConnectionPlatform | null;
  /** Social providers a connection of this provider can become. */
  socialProviders: readonly SocialProvider[];
  extraFields: readonly OAuthClientExtraField[];
  requiredExtraFields: readonly OAuthClientExtraField[];
}

const META_SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_metadata',
  'pages_manage_ads',
  'leads_retrieval',
  'instagram_basic',
  'instagram_content_publish',
] as const;

const LINKEDIN_SCOPES = ['r_ads', 'r_ads_reporting', 'w_organization_social', 'r_organization_social', 'rw_organization_admin'] as const;

export const OAUTH_PROVIDER_DEFINITIONS: Readonly<Record<OAuthProvider, OAuthProviderDefinition>> = {
  META: {
    provider: 'META',
    authorizeUrl: `https://${META_OAUTH_DIALOG_HOST}/${META_GRAPH_API_VERSION}/dialog/oauth`,
    tokenUrl: `https://${META_GRAPH_HOST}/${META_GRAPH_API_VERSION}/oauth/access_token`,
    identityUrl: `https://${META_GRAPH_HOST}/${META_GRAPH_API_VERSION}/me`,
    defaultScopes: META_SCOPES,
    allowedScopes: META_SCOPES,
    scopeSeparator: ',',
    pkce: false,
    extraAuthorizeParams: {},
    refresh: 'META_LONG_LIVED_EXCHANGE',
    adPlatform: 'META',
    socialProviders: ['META_PAGE', 'INSTAGRAM'],
    extraFields: ['configId'],
    requiredExtraFields: [],
  },
  GOOGLE: {
    provider: 'GOOGLE',
    authorizeUrl: `https://${GOOGLE_ACCOUNTS_HOST}/o/oauth2/v2/auth`,
    tokenUrl: `https://${GOOGLE_OAUTH_HOST}/token`,
    identityUrl: `https://${GOOGLE_ADS_HOST}/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
    defaultScopes: ['https://www.googleapis.com/auth/adwords'],
    allowedScopes: ['https://www.googleapis.com/auth/adwords'],
    scopeSeparator: ' ',
    pkce: true,
    extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
    refresh: 'REFRESH_TOKEN_GRANT',
    adPlatform: 'GOOGLE',
    socialProviders: [],
    extraFields: ['developerToken'],
    requiredExtraFields: ['developerToken'],
  },
  LINKEDIN: {
    provider: 'LINKEDIN',
    authorizeUrl: `https://${LINKEDIN_WWW_HOST}/oauth/v2/authorization`,
    tokenUrl: `https://${LINKEDIN_WWW_HOST}/oauth/v2/accessToken`,
    identityUrl: `https://${LINKEDIN_API_HOST}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
    defaultScopes: LINKEDIN_SCOPES,
    allowedScopes: LINKEDIN_SCOPES,
    scopeSeparator: ' ',
    pkce: false,
    extraAuthorizeParams: {},
    refresh: 'REFRESH_TOKEN_GRANT',
    adPlatform: null,
    socialProviders: ['LINKEDIN_ORG'],
    extraFields: [],
    requiredExtraFields: [],
  },
};

/** LinkedIn versioned REST header value used by the identity read (same as publishing). */
export const OAUTH_LINKEDIN_API_VERSION = SOCIAL_LINKEDIN_API_VERSION;

/** The host the browser is sent to for each provider (the web checks the start response against it). */
export const OAUTH_AUTHORIZE_HOSTS: Readonly<Record<OAuthProvider, string>> = {
  META: META_OAUTH_DIALOG_HOST,
  GOOGLE: GOOGLE_ACCOUNTS_HOST,
  LINKEDIN: LINKEDIN_WWW_HOST,
};

/** True when `url` is an https URL on the provider's authorize host and path (checked by the web before navigating). */
export function isExpectedAuthorizeUrl(provider: OAuthProvider, url: string): boolean {
  const base = OAUTH_PROVIDER_DEFINITIONS[provider].authorizeUrl;
  return url.startsWith(`${base}?`) && `https://${OAUTH_AUTHORIZE_HOSTS[provider]}/` === base.slice(0, `https://${OAUTH_AUTHORIZE_HOSTS[provider]}/`.length);
}

export function oauthProviderForAdPlatform(platform: string): OAuthProvider | null {
  const found = OAUTH_PROVIDERS.find((p) => OAUTH_PROVIDER_DEFINITIONS[p].adPlatform === platform);
  return found ?? null;
}

export function oauthProviderForSocial(provider: string): OAuthProvider | null {
  const found = OAUTH_PROVIDERS.find((p) => (OAUTH_PROVIDER_DEFINITIONS[p].socialProviders as readonly string[]).includes(provider));
  return found ?? null;
}

// ---------------------------------------------------------------------------
// Timing: state lifetime, refresh window and backoff
// ---------------------------------------------------------------------------

/** A started authorization must come back within this many minutes. */
export const OAUTH_STATE_TTL_MINUTES = 10;
/** Tokens expiring within this many hours are refreshed by the heartbeat. */
export const OAUTH_REFRESH_WINDOW_HOURS = 24;
/** Tokens that do not expire (Google refresh tokens) are checked this often, so a revoked grant shows up. */
export const OAUTH_HEALTH_CHECK_HOURS = 24;
/** Minutes to wait after the 1st, 2nd, ... transient refresh failure; after the last one the connection needs a reconnect. */
export const OAUTH_REFRESH_BACKOFF_MINUTES = [15, 60, 240] as const;
/** Most connections one heartbeat refreshes. */
export const OAUTH_MAX_REFRESH_PER_RUN = 20;
/** Used and expired states are deleted after this many hours. */
export const OAUTH_STATE_RETENTION_HOURS = 24;

const HOUR = 60 * 60 * 1000;

/**
 * When the heartbeat should look at a token next: 24 hours before it
 * expires (never in the past), or, for a token without an expiry (a Google
 * refresh token), one health check a day. Null means never (a Meta page
 * token derived from a long-lived user token, a system user token).
 */
export function oauthNextRefreshAt(provider: OAuthProvider, tokenExpiresAt: Date | null, hasRefreshToken: boolean, now: Date): Date | null {
  if (tokenExpiresAt) {
    const due = tokenExpiresAt.getTime() - OAUTH_REFRESH_WINDOW_HOURS * HOUR;
    return new Date(Math.max(due, now.getTime()));
  }
  if (provider === 'GOOGLE' && hasRefreshToken) return new Date(now.getTime() + OAUTH_HEALTH_CHECK_HOURS * HOUR);
  return null;
}

/** Milliseconds before the next attempt after `attemptsMade` (>= 1) transient failures, or null when the retries are used up. */
export function oauthRefreshRetryDelayMs(attemptsMade: number): number | null {
  const minutes = OAUTH_REFRESH_BACKOFF_MINUTES[attemptsMade - 1];
  return minutes === undefined ? null : minutes * 60_000;
}

// ---------------------------------------------------------------------------
// Start, callback and result
// ---------------------------------------------------------------------------

/** Fixed hub path per entry point: the callback only ever redirects to one of these on PUBLIC_APP_URL. */
export const OAUTH_RETURN_PATHS: Readonly<Record<IntegrationEntryPoint, string>> = {
  marketing: '/pazarlama/entegrasyonlar',
  admin: '/admin/entegrasyonlar',
};

export const OAUTH_TARGET_KINDS = ['NEW_AD_CONNECTION', 'NEW_SOCIAL_CONNECTION', 'RECONNECT_AD_CONNECTION', 'RECONNECT_SOCIAL_CONNECTION'] as const;
export type OAuthTargetKind = (typeof OAUTH_TARGET_KINDS)[number];

const TenDigits = z.string().trim().regex(/^\d{10}$/, '10 haneli müşteri kimliği bekleniyor');

export const OAuthStartTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('NEW_AD_CONNECTION'),
      label: z.string().trim().min(1).max(80),
      /** Meta ad account id (act_... or digits), Google customer id (10 digits). */
      externalAccountId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
      /** Meta only: the pixel / dataset id (public). */
      pixelId: z.string().trim().regex(/^\d{5,20}$/).optional(),
      /** Google only: the manager account that makes the calls; defaults to the customer id. */
      loginCustomerId: TenDigits.optional(),
      /** Google only: the public "AW-XXXXXXXXX" tag id. */
      conversionId: z.string().trim().regex(/^AW-\d+$/).optional(),
      isTestMode: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('NEW_SOCIAL_CONNECTION'),
      socialProvider: z.enum(SOCIAL_PROVIDERS),
      externalId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/),
      displayName: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('RECONNECT_AD_CONNECTION'), connectionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('RECONNECT_SOCIAL_CONNECTION'), connectionId: z.string().uuid() }).strict(),
]);
export type OAuthStartTarget = z.infer<typeof OAuthStartTargetSchema>;

/** POST /platform/integrations/oauth/:provider/start */
export const StartOAuthSchema = z
  .object({
    target: OAuthStartTargetSchema,
    /** Which hub page the browser returns to; the path itself is fixed (OAUTH_RETURN_PATHS). */
    returnTo: z.enum(['marketing', 'admin']).default('marketing'),
  })
  .strict();
export type StartOAuthInput = z.infer<typeof StartOAuthSchema>;

/** Why a start target does not fit the provider; empty when it does. */
export type OAuthTargetIssue = 'NO_AD_PLATFORM' | 'SOCIAL_PROVIDER_MISMATCH' | 'PIXEL_REQUIRED' | 'GOOGLE_FIELDS_REQUIRED' | 'FIELD_NOT_FOR_PROVIDER';

export function oauthTargetIssues(provider: OAuthProvider, target: OAuthStartTarget): OAuthTargetIssue[] {
  const def = OAUTH_PROVIDER_DEFINITIONS[provider];
  const issues: OAuthTargetIssue[] = [];
  if (target.kind === 'NEW_AD_CONNECTION') {
    if (!def.adPlatform) return ['NO_AD_PLATFORM'];
    if (def.adPlatform === 'META') {
      if (!target.pixelId) issues.push('PIXEL_REQUIRED');
      if (target.loginCustomerId || target.conversionId) issues.push('FIELD_NOT_FOR_PROVIDER');
    }
    if (def.adPlatform === 'GOOGLE') {
      if (!/^\d{10}$/.test(target.externalAccountId) || !target.conversionId) issues.push('GOOGLE_FIELDS_REQUIRED');
      if (target.pixelId) issues.push('FIELD_NOT_FOR_PROVIDER');
    }
  }
  if (target.kind === 'NEW_SOCIAL_CONNECTION' && !(def.socialProviders as readonly string[]).includes(target.socialProvider)) {
    issues.push('SOCIAL_PROVIDER_MISMATCH');
  }
  return issues;
}

/** 32 random bytes, base64url without padding. */
export const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** GET /platform/integrations/oauth/:provider/callback (unknown provider parameters are dropped). */
export const OAuthCallbackQuerySchema = z.object({
  state: z.string().regex(OAUTH_STATE_PATTERN),
  code: z.string().min(1).max(2048).optional(),
  /** Set by the provider when the person declined or the request was refused; never echoed. */
  error: z.string().max(200).optional(),
});
export type OAuthCallbackQuery = z.infer<typeof OAuthCallbackQuerySchema>;

/** Stable error codes of the start endpoint (BFF translation: integrationsOAuth.error.*). */
export const OAUTH_ERROR_CODES = ['OAUTH_PROVIDER_NOT_CONFIGURED', 'OAUTH_TARGET_INVALID', 'OAUTH_TARGET_NOT_FOUND', 'OAUTH_STATE_INVALID', 'OAUTH_RATE_LIMITED'] as const;
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

/** Translation keys the web BFF substitutes for the API message (TRANSLATED_API_ERROR_CODES). */
export const OAUTH_TRANSLATED_ERRORS = {
  OAUTH_PROVIDER_NOT_CONFIGURED: 'integrationsOAuth.error.OAUTH_PROVIDER_NOT_CONFIGURED',
  OAUTH_TARGET_INVALID: 'integrationsOAuth.error.OAUTH_TARGET_INVALID',
  OAUTH_TARGET_NOT_FOUND: 'integrationsOAuth.error.OAUTH_TARGET_NOT_FOUND',
  OAUTH_STATE_INVALID: 'integrationsOAuth.error.OAUTH_STATE_INVALID',
  OAUTH_RATE_LIMITED: 'integrationsOAuth.error.OAUTH_RATE_LIMITED',
  OAUTH_CLIENT_INVALID: 'integrationsOAuth.error.OAUTH_CLIENT_INVALID',
} as const satisfies Record<OAuthErrorCode | 'OAUTH_CLIENT_INVALID', string>;

/** Fixed reason codes on the redirect back to the hub; provider text is never passed on. */
export const OAUTH_RESULT_REASONS = [
  'DENIED',
  'NOT_CONFIGURED',
  'EXCHANGE_FAILED',
  'IDENTITY_FAILED',
  'ACCOUNT_NOT_ACCESSIBLE',
  'MISSING_REFRESH_TOKEN',
  'TARGET_GONE',
  'DUPLICATE',
  'INTERNAL',
] as const;
export type OAuthResultReason = (typeof OAUTH_RESULT_REASONS)[number];

export type OAuthResult = { ok: true; provider: OAuthProvider } | { ok: false; provider: OAuthProvider; reason: OAuthResultReason };

/** Reads the `?oauth=` landing parameters of the hub; anything unexpected is ignored. */
export function parseOAuthLanding(params: { get(name: string): string | null }): OAuthResult | null {
  const status = params.get('oauth');
  const provider = oauthProviderFromSlug(params.get('provider') ?? '');
  if (!provider || (status !== 'ok' && status !== 'error')) return null;
  if (status === 'ok') return { ok: true, provider };
  const reason = params.get('reason');
  const known = OAUTH_RESULT_REASONS.find((r) => r === reason);
  return { ok: false, provider, reason: known ?? 'INTERNAL' };
}

export interface OAuthStartResultDTO {
  authorizeUrl: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Client settings (super admin)
// ---------------------------------------------------------------------------

const OAuthScope = z.string().trim().regex(/^[A-Za-z0-9_.:/-]{1,120}$/);

/** PUT /admin/integrations/oauth/:provider; a missing secret or developer token keeps the stored one. */
export const SetOAuthClientSchema = z
  .object({
    clientId: z.string().trim().min(4).max(300).regex(/^[\x21-\x7e]+$/),
    clientSecret: z.string().trim().min(8).max(500).regex(/^[\x21-\x7e]+$/).optional(),
    scopes: z.array(OAuthScope).min(1).max(30).optional(),
    /** Meta only: Facebook Login for Business configuration id (replaces the scope list at Meta). */
    configId: z.string().trim().regex(/^\d{5,30}$/).nullable().optional(),
    /** Google only: the Google Ads API developer token. */
    developerToken: z.string().trim().min(10).max(200).regex(/^[\x21-\x7e]+$/).optional(),
  })
  .strict();
export type SetOAuthClientInput = z.infer<typeof SetOAuthClientSchema>;

export type OAuthClientIssue = 'SECRET_REQUIRED' | 'SCOPE_NOT_ALLOWED' | 'FIELD_NOT_FOR_PROVIDER' | 'DEVELOPER_TOKEN_REQUIRED';

/** Checks a client setting against the provider; `stored` says what is already saved. */
export function oauthClientIssues(
  provider: OAuthProvider,
  input: SetOAuthClientInput,
  stored: { hasSecret: boolean; hasDeveloperToken: boolean },
): OAuthClientIssue[] {
  const def = OAUTH_PROVIDER_DEFINITIONS[provider];
  const issues: OAuthClientIssue[] = [];
  if (!input.clientSecret && !stored.hasSecret) issues.push('SECRET_REQUIRED');
  if (input.scopes && input.scopes.some((s) => !def.allowedScopes.includes(s))) issues.push('SCOPE_NOT_ALLOWED');
  if ((input.configId !== undefined && input.configId !== null && !def.extraFields.includes('configId')) || (input.developerToken !== undefined && !def.extraFields.includes('developerToken'))) {
    issues.push('FIELD_NOT_FOR_PROVIDER');
  }
  if (def.requiredExtraFields.includes('developerToken') && !input.developerToken && !stored.hasDeveloperToken) issues.push('DEVELOPER_TOKEN_REQUIRED');
  return issues;
}

/** Masked view of one provider's client settings: never the id, the secret or the developer token themselves. */
export interface OAuthClientSettingsDTO {
  provider: OAuthProvider;
  configured: boolean;
  clientIdPreview: string | null;
  clientSecretPreview: string | null;
  scopes: string[];
  configIdSet: boolean;
  developerTokenPreview: string | null;
  updatedAt: string | null;
}

export interface HubOAuthProviderDTO {
  provider: OAuthProvider;
  /** A client id and secret (and any required extra) are saved: the connect buttons work. */
  configured: boolean;
  pkce: boolean;
  adPlatform: AdConnectionPlatform | null;
  socialProviders: SocialProvider[];
  /** The exact redirect URI to register in the provider's app. */
  redirectUri: string;
}

export interface HubOAuthDTO {
  providers: HubOAuthProviderDTO[];
  /** Super admin only (null for everyone else): the masked client settings. */
  clients: OAuthClientSettingsDTO[] | null;
}

/** OAuth fields every hub connection card carries (ad and social). */
export interface HubConnectionAuthDTO {
  authMethod: IntegrationAuthMethod;
  oauthProvider: OAuthProvider | null;
  tokenExpiresAt: string | null;
  reauthRequired: boolean;
}
