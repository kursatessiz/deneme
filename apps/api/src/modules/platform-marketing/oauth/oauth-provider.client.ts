import { Injectable } from '@nestjs/common';
import {
  META_GRAPH_API_VERSION,
  META_GRAPH_HOST,
  LINKEDIN_API_HOST,
  OAUTH_LINKEDIN_API_VERSION,
  OAUTH_PROVIDER_DEFINITIONS,
  type OAuthProvider,
} from '@platform/shared';
import { AdsHttpClient, HOST_NOT_ALLOWED_MESSAGE, type AdsHttpResponse } from '../../ads/ads-http-client';
import { sanitizeProviderCode } from './oauth-crypto';

/** What a token endpoint gave back, normalised across providers. */
export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Lifetime of the access token in seconds, when the provider said. */
  expiresInSec: number | null;
  /** Lifetime of the refresh token in seconds (Google time-limited grants, LinkedIn). */
  refreshExpiresInSec: number | null;
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  instagram: { id: string; username: string | null } | null;
}

/**
 * A failed provider call. `kind` decides what the refresh job does:
 * TRANSIENT (network, 5xx, 429, Meta rate limit codes) is retried with
 * backoff, PERMANENT (invalid_grant, revoked or expired token, other 4xx)
 * needs a person to reconnect. `code` is a sanitized provider error code,
 * never a description, a token or a URL.
 */
export class OAuthCallError extends Error {
  constructor(
    readonly kind: 'TRANSIENT' | 'PERMANENT',
    readonly code: string,
  ) {
    super(`oauth ${kind.toLowerCase()} failure: ${code}`);
    this.name = 'OAuthCallError';
  }
}

/** Meta Graph error codes that are about load or throttling, not about the token. */
const META_TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

/** Classifies a non-2xx token or identity response. Exported for the unit tests. */
export function classifyOAuthFailure(res: Pick<AdsHttpResponse, 'status' | 'body'>): OAuthCallError {
  const body = res.body && typeof res.body === 'object' ? (res.body as Record<string, unknown>) : {};
  const metaError = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>) : null;
  if (metaError) {
    const code = typeof metaError.code === 'number' ? metaError.code : null;
    if (code !== null && META_TRANSIENT_CODES.has(code)) return new OAuthCallError('TRANSIENT', `meta_${code}`);
    if (res.status >= 500) return new OAuthCallError('TRANSIENT', `http_${res.status}`);
    return new OAuthCallError('PERMANENT', code !== null ? `meta_${code}` : `http_${res.status}`);
  }
  if (res.status >= 500 || res.status === 429) return new OAuthCallError('TRANSIENT', `http_${res.status}`);
  if (typeof body.error === 'string') return new OAuthCallError('PERMANENT', sanitizeProviderCode(body.error));
  return new OAuthCallError('PERMANENT', `http_${res.status}`);
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Every network call of the OAuth flow, through the allow-listed
 * AdsHttpClient with the `oauth:<PROVIDER>` scope (graph.facebook.com,
 * oauth2.googleapis.com, accounts.google.com, googleads.googleapis.com,
 * www.linkedin.com, api.linkedin.com). Access tokens travel in the
 * Authorization header; client secrets in a form body, except for Meta's
 * documented GET exchange. Nothing here logs a request or a response.
 */
@Injectable()
export class OAuthProviderClient {
  constructor(private readonly http: AdsHttpClient) {}

  /** Authorization code -> tokens. For Meta a short-lived user token is exchanged for a long-lived one right away. */
  async exchangeCode(provider: OAuthProvider, client: OAuthClientCredentials, input: { code: string; redirectUri: string; codeVerifier: string | null }): Promise<OAuthTokenSet> {
    const def = OAUTH_PROVIDER_DEFINITIONS[provider];
    if (provider === 'META') {
      const url = new URL(def.tokenUrl);
      url.searchParams.set('client_id', client.clientId);
      url.searchParams.set('redirect_uri', input.redirectUri);
      url.searchParams.set('client_secret', client.clientSecret);
      url.searchParams.set('code', input.code);
      const short = this.tokenSet(await this.call(() => this.http.getJson('oauth:META', url.toString(), { accept: 'application/json' })));
      // A system user token (Business Login configuration) has no expiry: nothing to extend.
      if (short.expiresInSec === null) return short;
      return this.metaLongLived(client, short.accessToken);
    }
    const form: Record<string, string> = {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    };
    if (input.codeVerifier) form.code_verifier = input.codeVerifier;
    return this.tokenSet(await this.call(() => this.http.postForm(`oauth:${provider}`, def.tokenUrl, {}, form)));
  }

  /** Meta: a still-valid user token for a long-lived one (about 60 days). */
  async metaLongLived(client: OAuthClientCredentials, token: string): Promise<OAuthTokenSet> {
    const url = new URL(OAUTH_PROVIDER_DEFINITIONS.META.tokenUrl);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', client.clientId);
    url.searchParams.set('client_secret', client.clientSecret);
    url.searchParams.set('fb_exchange_token', token);
    return this.tokenSet(await this.call(() => this.http.getJson('oauth:META', url.toString(), { accept: 'application/json' })));
  }

  /** Standard refresh token grant (Google, LinkedIn). */
  async refreshGrant(provider: 'GOOGLE' | 'LINKEDIN', client: OAuthClientCredentials, refreshToken: string): Promise<OAuthTokenSet> {
    const form = { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret };
    return this.tokenSet(await this.call(() => this.http.postForm(`oauth:${provider}`, OAUTH_PROVIDER_DEFINITIONS[provider].tokenUrl, {}, form)));
  }

  /** Meta ad account ids (digits, without `act_`) the user token can reach (first 200). */
  async metaAdAccountIds(token: string): Promise<string[]> {
    const body = await this.getOk('oauth:META', `https://${META_GRAPH_HOST}/${META_GRAPH_API_VERSION}/me/adaccounts?fields=account_id&limit=200`, token);
    const data = Array.isArray((body as { data?: unknown }).data) ? ((body as { data: unknown[] }).data as Record<string, unknown>[]) : [];
    return data.map((a) => str(a.account_id) ?? str(a.id)?.replace(/^act_/, '') ?? '').filter((id) => id.length > 0);
  }

  /** Facebook Pages the user manages, each with its page token and linked Instagram business account (first 200). */
  async metaPages(token: string): Promise<MetaPage[]> {
    const fields = encodeURIComponent('id,name,access_token,instagram_business_account{id,username}');
    const body = await this.getOk('oauth:META', `https://${META_GRAPH_HOST}/${META_GRAPH_API_VERSION}/me/accounts?fields=${fields}&limit=200`, token);
    const data = Array.isArray((body as { data?: unknown }).data) ? ((body as { data: unknown[] }).data as Record<string, unknown>[]) : [];
    const pages: MetaPage[] = [];
    for (const p of data) {
      const id = str(p.id);
      const accessToken = str(p.access_token);
      if (!id || !accessToken) continue;
      const ig = p.instagram_business_account && typeof p.instagram_business_account === 'object' ? (p.instagram_business_account as Record<string, unknown>) : null;
      pages.push({ id, name: str(p.name) ?? id, accessToken, instagram: ig && str(ig.id) ? { id: str(ig.id) as string, username: str(ig.username) } : null });
    }
    return pages;
  }

  /** Google Ads customer ids (10 digits) directly accessible with this grant. */
  async googleAccessibleCustomers(accessToken: string, developerToken: string): Promise<string[]> {
    const res = await this.call(() => this.http.getJson('oauth:GOOGLE', OAUTH_PROVIDER_DEFINITIONS.GOOGLE.identityUrl, { authorization: `Bearer ${accessToken}`, 'developer-token': developerToken }));
    if (!res.ok) throw classifyOAuthFailure(res);
    const names = (res.body as { resourceNames?: unknown } | null)?.resourceNames;
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string').map((n) => n.replace(/^customers\//, '')) : [];
  }

  /** LinkedIn organization ids the member administers (approved ADMINISTRATOR role). */
  async linkedinAdminOrgIds(accessToken: string): Promise<string[]> {
    const res = await this.call(() => this.http.getJson('oauth:LINKEDIN', OAUTH_PROVIDER_DEFINITIONS.LINKEDIN.identityUrl, this.linkedinHeaders(accessToken)));
    if (!res.ok) throw classifyOAuthFailure(res);
    const elements = (res.body as { elements?: unknown } | null)?.elements;
    if (!Array.isArray(elements)) return [];
    return elements
      .map((e) => (e && typeof e === 'object' ? str((e as Record<string, unknown>).organization) ?? str((e as Record<string, unknown>).organizationTarget) : null))
      .filter((urn): urn is string => urn !== null)
      .map((urn) => urn.replace(/^urn:li:organization:/, ''));
  }

  /** Best effort: the organization's name for the hub card; null on any failure. */
  async linkedinOrgName(accessToken: string, orgId: string): Promise<string | null> {
    if (!/^\d{1,20}$/.test(orgId)) return null;
    try {
      const res = await this.http.getJson('oauth:LINKEDIN', `https://${LINKEDIN_API_HOST}/rest/organizations/${orgId}`, this.linkedinHeaders(accessToken));
      return res.ok ? str((res.body as { localizedName?: unknown } | null)?.localizedName) : null;
    } catch {
      return null;
    }
  }

  private linkedinHeaders(accessToken: string): Record<string, string> {
    return { authorization: `Bearer ${accessToken}`, 'linkedin-version': OAUTH_LINKEDIN_API_VERSION, 'x-restli-protocol-version': '2.0.0' };
  }

  private async getOk(scope: 'oauth:META', url: string, token: string): Promise<unknown> {
    const res = await this.call(() => this.http.getJson(scope, url, { authorization: `Bearer ${token}` }));
    if (!res.ok) throw classifyOAuthFailure(res);
    return res.body ?? {};
  }

  private tokenSet(res: AdsHttpResponse): OAuthTokenSet {
    if (!res.ok) throw classifyOAuthFailure(res);
    const body = res.body && typeof res.body === 'object' ? (res.body as Record<string, unknown>) : {};
    const accessToken = str(body.access_token);
    if (!accessToken) throw new OAuthCallError('PERMANENT', 'no_access_token');
    return {
      accessToken,
      refreshToken: str(body.refresh_token),
      expiresInSec: positiveInt(body.expires_in),
      refreshExpiresInSec: positiveInt(body.refresh_token_expires_in),
    };
  }

  /** Network errors and timeouts are transient; an allow-list refusal is a permanent (configuration) error. */
  private async call(fn: () => Promise<AdsHttpResponse>): Promise<AdsHttpResponse> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof OAuthCallError) throw err;
      if (err instanceof Error && err.message.includes(HOST_NOT_ALLOWED_MESSAGE)) throw new OAuthCallError('PERMANENT', 'host_not_allowed');
      throw new OAuthCallError('TRANSIENT', 'network');
    }
  }
}
