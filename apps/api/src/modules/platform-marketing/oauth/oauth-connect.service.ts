import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type OauthState } from '@platform/database';
import {
  OAUTH_PROVIDERS,
  OAUTH_PROVIDER_DEFINITIONS,
  OAUTH_PROVIDER_SLUGS,
  OAUTH_STATE_TTL_MINUTES,
  OAuthStartTargetSchema,
  SocialCredentialsSchema,
  credentialLast4Of,
  oauthNextRefreshAt,
  oauthProviderForAdPlatform,
  oauthProviderForSocial,
  oauthTargetIssues,
  validateCredentialsFor,
  type AdConnectionCredentials,
  type GoogleCredentials,
  type HubOAuthDTO,
  type IntegrationEntryPoint,
  type MetaCredentials,
  type OAuthCallbackQuery,
  type OAuthProvider,
  type OAuthResult,
  type OAuthResultReason,
  type OAuthStartResultDTO,
  type OAuthStartTarget,
  type SocialCredentials,
  type SocialProvider,
  type StartOAuthInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { pixelOrDatasetIdOf } from '../../ads/connections/ad-connections.service';
import { CredentialCipher } from '../../../common/crypto/credential-cipher';
import type { PlatformContext } from '../../auth/tenant-context';
import { OAuthClientSettingsService, type ResolvedOAuthClient } from './oauth-client-settings.service';
import { OAuthCallError, OAuthProviderClient, type OAuthTokenSet } from './oauth-provider.client';
import { codeChallengeS256, constantTimeEqualHex, generateCodeVerifier, generateOAuthState, hashOAuthState, sanitizeProviderCode } from './oauth-crypto';
import { buildOAuthReturnUrl, isAllowedReturnUrl } from './oauth-redirect';
import { apiError, codedError } from '../../../common/api-error';

const MINUTE = 60_000;

function oauthError(status: 400 | 404 | 409, code: string, extra: Record<string, unknown> = {}) {
  const body = codedError(code, { statusCode: status, ...extra });
  if (status === 404) return new NotFoundException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
}

/** A callback step that failed for a known reason; the reason goes on the redirect, the detail (sanitized) into the audit row. */
class OAuthFlowFailure extends Error {
  constructor(
    readonly reason: OAuthResultReason,
    readonly detail: string,
  ) {
    super(reason);
  }
}

type NewAdParams = Extract<OAuthStartTarget, { kind: 'NEW_AD_CONNECTION' }>;
type NewSocialParams = Extract<OAuthStartTarget, { kind: 'NEW_SOCIAL_CONNECTION' }>;

/**
 * OAuth connect (M4a, docs/PAZARLAMA_MODULU.md 5.2). `start` records a
 * one-time state (SHA-256 at rest, 10 minutes, bound to the tenant, the
 * user, the provider and the target) plus a PKCE verifier where the
 * provider takes one, and returns the provider's consent URL. `callback`
 * consumes the state exactly once, exchanges the code through the
 * allow-listed client, checks that the granted identity reaches the
 * account the target names, stores the tokens encrypted on the
 * AdConnection or SocialConnection and returns the fixed hub URL to
 * redirect to. Tokens never appear in a response, a log line or an audit
 * row; provider error text is reduced to a sanitized code.
 */
@Injectable()
export class OAuthConnectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cipher: CredentialCipher,
    private readonly clients: OAuthClientSettingsService,
    private readonly providers: OAuthProviderClient,
  ) {}

  /** The redirect URI registered at the provider: PUBLIC_API_URL plus the fixed callback path. */
  redirectUri(provider: OAuthProvider): string {
    const base = this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000').replace(/\/+$/, '');
    return `${base}/platform/integrations/oauth/${OAUTH_PROVIDER_SLUGS[provider]}/callback`;
  }

  async hubOAuth(isSuperAdmin: boolean): Promise<HubOAuthDTO> {
    const configured = await this.clients.configuredProviders();
    return {
      providers: OAUTH_PROVIDERS.map((provider) => {
        const def = OAUTH_PROVIDER_DEFINITIONS[provider];
        return {
          provider,
          configured: configured.has(provider),
          pkce: def.pkce,
          adPlatform: def.adPlatform,
          socialProviders: [...def.socialProviders],
          redirectUri: this.redirectUri(provider),
        };
      }),
      clients: isSuperAdmin ? await this.clients.list() : null,
    };
  }

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  async start(platform: PlatformContext, via: IntegrationEntryPoint, provider: OAuthProvider, input: StartOAuthInput): Promise<OAuthStartResultDTO> {
    if (this.config.get<string>('NODE_ENV') === 'production' && !this.cipher.isConfigured) {
      throw oauthError(409, 'OAUTH_PROVIDER_NOT_CONFIGURED');
    }
    const client = await this.clients.resolve(provider);
    if (!client) throw oauthError(409, 'OAUTH_PROVIDER_NOT_CONFIGURED');
    const issues = oauthTargetIssues(provider, input.target);
    if (issues.length > 0) throw oauthError(400, 'OAUTH_TARGET_INVALID', { issues });

    const studioId = platform.platformStudioId;
    const target = input.target;
    let targetId: string | null = null;
    let targetParams: Record<string, unknown> = {};
    switch (target.kind) {
      case 'NEW_AD_CONNECTION':
      case 'NEW_SOCIAL_CONNECTION':
        targetParams = { ...target };
        break;
      case 'RECONNECT_AD_CONNECTION': {
        const row = await this.prisma.adConnection.findFirst({ where: { id: target.connectionId, studioId }, select: { id: true, platform: true } });
        if (!row) throw oauthError(404, 'OAUTH_TARGET_NOT_FOUND');
        if (oauthProviderForAdPlatform(row.platform) !== provider) throw oauthError(400, 'OAUTH_TARGET_INVALID', { issues: ['NO_AD_PLATFORM'] });
        targetId = row.id;
        break;
      }
      case 'RECONNECT_SOCIAL_CONNECTION': {
        const row = await this.prisma.socialConnection.findFirst({ where: { id: target.connectionId, studioId }, select: { id: true, provider: true } });
        if (!row) throw oauthError(404, 'OAUTH_TARGET_NOT_FOUND');
        if (oauthProviderForSocial(row.provider) !== provider) throw oauthError(400, 'OAUTH_TARGET_INVALID', { issues: ['SOCIAL_PROVIDER_MISMATCH'] });
        targetId = row.id;
        break;
      }
    }

    const def = OAUTH_PROVIDER_DEFINITIONS[provider];
    const state = generateOAuthState();
    const verifier = def.pkce ? generateCodeVerifier() : null;
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * MINUTE);
    const row = await this.prisma.oauthState.create({
      data: {
        studioId,
        userId: platform.userId,
        provider,
        stateHash: hashOAuthState(state),
        encryptedCodeVerifier: verifier ? this.cipher.encrypt(verifier) : null,
        targetKind: target.kind,
        targetId,
        targetParams: targetParams as Prisma.InputJsonValue,
        // Only a super admin can be sent back to the admin panel.
        returnTo: platform.isSuperAdmin ? input.returnTo : 'marketing',
        expiresAt,
      },
    });

    const params = new URLSearchParams({ client_id: client.clientId, redirect_uri: this.redirectUri(provider), response_type: 'code', state });
    if (provider === 'META' && client.configId) params.set('config_id', client.configId);
    else params.set('scope', client.scopes.join(def.scopeSeparator));
    if (verifier) {
      params.set('code_challenge', codeChallengeS256(verifier));
      params.set('code_challenge_method', 'S256');
    }
    for (const [key, value] of Object.entries(def.extraAuthorizeParams)) params.set(key, value);

    await this.audit(studioId, platform.userId, 'integration.oauth.start', row.id, { provider, targetKind: target.kind, targetId, via });
    return { authorizeUrl: `${def.authorizeUrl}?${params.toString()}`, expiresAt: expiresAt.toISOString() };
  }

  // -------------------------------------------------------------------------
  // Callback
  // -------------------------------------------------------------------------

  /**
   * Returns the URL to redirect the browser to. An unknown, reused, expired
   * or other-provider state is a 400 (there is no trustworthy place to send
   * the browser); everything after a valid state ends in a redirect.
   */
  async callback(provider: OAuthProvider, query: OAuthCallbackQuery): Promise<string> {
    const hash = hashOAuthState(query.state);
    const row = await this.prisma.oauthState.findUnique({ where: { stateHash: hash } });
    if (!row || !constantTimeEqualHex(row.stateHash, hash)) throw this.stateInvalid();
    const now = new Date();
    // Single use: only the first callback with an unexpired state claims it.
    const claimed = await this.prisma.oauthState.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) {
      await this.auditFailure(row, 'STATE_INVALID', row.usedAt ? 'state_reused' : 'state_expired');
      throw this.stateInvalid();
    }
    if (row.provider !== provider) {
      await this.auditFailure(row, 'STATE_INVALID', 'provider_mismatch');
      throw this.stateInvalid();
    }

    let result: OAuthResult;
    try {
      const connectionId = await this.complete(row, provider, query);
      await this.audit(row.studioId, row.userId, 'integration.oauth.connected', connectionId, { provider, targetKind: row.targetKind, via: row.returnTo });
      result = { ok: true, provider };
    } catch (err) {
      const failure = err instanceof OAuthFlowFailure ? err : new OAuthFlowFailure('INTERNAL', err instanceof OAuthCallError ? err.code : 'unexpected');
      await this.auditFailure(row, failure.reason, failure.detail);
      result = { ok: false, provider, reason: failure.reason };
    }
    const appBase = this.config.get<string>('PUBLIC_APP_URL', 'http://localhost:3000');
    const url = buildOAuthReturnUrl(appBase, row.returnTo, result);
    if (!isAllowedReturnUrl(appBase, url)) throw new BadRequestException(apiError('apiErrors.platformMarketing.invalidReturnAddress'));
    return url;
  }

  private async complete(row: OauthState, provider: OAuthProvider, query: OAuthCallbackQuery): Promise<string> {
    if (query.error || !query.code) throw new OAuthFlowFailure('DENIED', sanitizeProviderCode(query.error ?? 'missing_code'));
    const client = await this.clients.resolve(provider);
    if (!client) throw new OAuthFlowFailure('NOT_CONFIGURED', 'client_missing');
    const verifier = row.encryptedCodeVerifier ? this.cipher.decrypt(row.encryptedCodeVerifier) : null;

    let tokens: OAuthTokenSet;
    try {
      tokens = await this.providers.exchangeCode(provider, client, { code: query.code, redirectUri: this.redirectUri(provider), codeVerifier: verifier });
    } catch (err) {
      throw new OAuthFlowFailure('EXCHANGE_FAILED', err instanceof OAuthCallError ? err.code : 'unexpected');
    }

    const now = new Date();
    if (row.targetKind === 'NEW_AD_CONNECTION' || row.targetKind === 'RECONNECT_AD_CONNECTION') {
      return this.applyToAdConnection(row, provider, client, tokens, now);
    }
    return this.applyToSocialConnection(row, provider, tokens, now);
  }

  /** Identity calls fail as IDENTITY_FAILED; the account check as ACCOUNT_NOT_ACCESSIBLE. */
  private async identity<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new OAuthFlowFailure('IDENTITY_FAILED', err instanceof OAuthCallError ? err.code : 'unexpected');
    }
  }

  private async applyToAdConnection(row: OauthState, provider: OAuthProvider, client: ResolvedOAuthClient, tokens: OAuthTokenSet, now: Date): Promise<string> {
    const platform = OAUTH_PROVIDER_DEFINITIONS[provider].adPlatform;
    if (!platform) throw new OAuthFlowFailure('INTERNAL', 'no_ad_platform');
    const existing =
      row.targetKind === 'RECONNECT_AD_CONNECTION' && row.targetId ? await this.prisma.adConnection.findFirst({ where: { id: row.targetId, studioId: row.studioId } }) : null;
    if (row.targetKind === 'RECONNECT_AD_CONNECTION' && !existing) throw new OAuthFlowFailure('TARGET_GONE', 'connection_deleted');
    const params = existing ? null : this.newAdParams(row);
    const externalAccountId = existing?.externalAccountId ?? params?.externalAccountId ?? '';
    const prior = existing ? this.priorCredentials(existing.encryptedCredentials) : null;

    let credentials: AdConnectionCredentials;
    let refreshToken: string | null = null;
    let tokenExpiresAt: Date | null = null;
    if (platform === 'META') {
      const accounts = await this.identity(() => this.providers.metaAdAccountIds(tokens.accessToken));
      if (!accounts.includes(externalAccountId.replace(/^act_/, ''))) throw new OAuthFlowFailure('ACCOUNT_NOT_ACCESSIBLE', 'ad_account');
      const before = (prior ?? {}) as Partial<MetaCredentials>;
      credentials = { ...before, accessToken: tokens.accessToken, pixelId: before.pixelId ?? params?.pixelId ?? '' } as MetaCredentials;
      tokenExpiresAt = tokens.expiresInSec ? new Date(now.getTime() + tokens.expiresInSec * 1000) : null;
    } else {
      if (!tokens.refreshToken) throw new OAuthFlowFailure('MISSING_REFRESH_TOKEN', 'no_refresh_token');
      if (!client.developerToken) throw new OAuthFlowFailure('NOT_CONFIGURED', 'developer_token_missing');
      const before = (prior ?? {}) as Partial<GoogleCredentials>;
      const customerId = before.customerId ?? externalAccountId;
      const loginCustomerId = before.loginCustomerId ?? params?.loginCustomerId ?? customerId;
      const developerToken = client.developerToken;
      const customers = await this.identity(() => this.providers.googleAccessibleCustomers(tokens.accessToken, developerToken));
      if (!customers.includes(loginCustomerId) && !customers.includes(customerId)) throw new OAuthFlowFailure('ACCOUNT_NOT_ACCESSIBLE', 'customer');
      refreshToken = tokens.refreshToken;
      credentials = {
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        refreshToken,
        developerToken,
        loginCustomerId,
        customerId,
        conversionId: before.conversionId ?? params?.conversionId ?? '',
      } satisfies GoogleCredentials;
      tokenExpiresAt = tokens.refreshExpiresInSec ? new Date(now.getTime() + tokens.refreshExpiresInSec * 1000) : null;
    }
    if (!validateCredentialsFor(platform, credentials).success) throw new OAuthFlowFailure('INTERNAL', 'credentials_invalid');

    const data = {
      encryptedCredentials: this.cipher.encrypt(JSON.stringify(credentials)),
      credentialLast4: credentialLast4Of(platform, credentials),
      pixelOrDatasetId: pixelOrDatasetIdOf(platform, credentials),
      status: 'CONNECTED',
      lastError: null,
      authMethod: 'OAUTH',
      oauthProvider: provider,
      tokenExpiresAt,
      encryptedRefreshToken: refreshToken ? this.cipher.encrypt(refreshToken) : null,
      connectedByUserId: row.userId,
      refreshAttempts: 0,
      nextRefreshAt: oauthNextRefreshAt(provider, tokenExpiresAt, refreshToken !== null, now),
    };
    if (existing) {
      await this.prisma.adConnection.update({ where: { id: existing.id }, data });
      return existing.id;
    }
    try {
      const created = await this.prisma.adConnection.create({
        data: { ...data, studioId: row.studioId, platform, label: params?.label ?? platform, externalAccountId, isTestMode: params?.isTestMode ?? false },
      });
      return created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new OAuthFlowFailure('DUPLICATE', 'label_taken');
      throw err;
    }
  }

  private async applyToSocialConnection(row: OauthState, provider: OAuthProvider, tokens: OAuthTokenSet, now: Date): Promise<string> {
    const existing =
      row.targetKind === 'RECONNECT_SOCIAL_CONNECTION' && row.targetId ? await this.prisma.socialConnection.findFirst({ where: { id: row.targetId, studioId: row.studioId } }) : null;
    if (row.targetKind === 'RECONNECT_SOCIAL_CONNECTION' && !existing) throw new OAuthFlowFailure('TARGET_GONE', 'connection_deleted');
    const params = existing ? null : this.newSocialParams(row);
    const socialProvider: SocialProvider = existing?.provider ?? params?.socialProvider ?? 'META_PAGE';
    const externalId = existing?.externalId ?? params?.externalId ?? '';

    let credentials: SocialCredentials;
    let displayName: string;
    let refreshToken: string | null = null;
    let tokenExpiresAt: Date | null = null;
    if (provider === 'META') {
      const pages = await this.identity(() => this.providers.metaPages(tokens.accessToken));
      if (socialProvider === 'INSTAGRAM') {
        const page = pages.find((p) => p.instagram?.id === externalId);
        if (!page) throw new OAuthFlowFailure('ACCOUNT_NOT_ACCESSIBLE', 'instagram_account');
        credentials = { accessToken: page.accessToken, apiHost: 'graph.facebook.com' };
        displayName = page.instagram?.username ?? page.name;
      } else {
        const page = pages.find((p) => p.id === externalId);
        if (!page) throw new OAuthFlowFailure('ACCOUNT_NOT_ACCESSIBLE', 'page');
        credentials = { accessToken: page.accessToken };
        displayName = page.name;
      }
      // A page token derived from a long-lived user token does not expire (Meta access token documentation).
    } else {
      const orgs = await this.identity(() => this.providers.linkedinAdminOrgIds(tokens.accessToken));
      if (!orgs.includes(externalId)) throw new OAuthFlowFailure('ACCOUNT_NOT_ACCESSIBLE', 'organization');
      credentials = { accessToken: tokens.accessToken };
      displayName = (await this.providers.linkedinOrgName(tokens.accessToken, externalId)) ?? params?.displayName ?? externalId;
      refreshToken = tokens.refreshToken;
      tokenExpiresAt = tokens.expiresInSec ? new Date(now.getTime() + tokens.expiresInSec * 1000) : null;
    }
    const parsed = SocialCredentialsSchema.safeParse(credentials);
    if (!parsed.success) throw new OAuthFlowFailure('INTERNAL', 'credentials_invalid');

    const data = {
      encryptedCredentials: this.cipher.encrypt(JSON.stringify(parsed.data)),
      credentialLast4: parsed.data.accessToken.slice(-4),
      status: 'CONNECTED' as const,
      lastError: null,
      authMethod: 'OAUTH',
      oauthProvider: provider,
      tokenExpiresAt,
      encryptedRefreshToken: refreshToken ? this.cipher.encrypt(refreshToken) : null,
      connectedByUserId: row.userId,
      refreshAttempts: 0,
      nextRefreshAt: oauthNextRefreshAt(provider, tokenExpiresAt, refreshToken !== null, now),
    };
    if (existing) {
      // A name a person typed is kept; the id placeholder is replaced by the real name.
      await this.prisma.socialConnection.update({
        where: { id: existing.id },
        data: { ...data, ...(existing.displayName === existing.externalId ? { displayName } : {}) },
      });
      return existing.id;
    }
    // Connecting an account that is already there re-links it (same tenant, provider and account id).
    const saved = await this.prisma.socialConnection.upsert({
      where: { studioId_provider_externalId: { studioId: row.studioId, provider: socialProvider, externalId } },
      create: { ...data, studioId: row.studioId, provider: socialProvider, externalId, displayName: params?.displayName ?? displayName },
      update: data,
    });
    return saved.id;
  }

  private newAdParams(row: OauthState): NewAdParams {
    const parsed = OAuthStartTargetSchema.safeParse(row.targetParams);
    if (!parsed.success || parsed.data.kind !== 'NEW_AD_CONNECTION') throw new OAuthFlowFailure('INTERNAL', 'target_params');
    return parsed.data;
  }

  private newSocialParams(row: OauthState): NewSocialParams {
    const parsed = OAuthStartTargetSchema.safeParse(row.targetParams);
    if (!parsed.success || parsed.data.kind !== 'NEW_SOCIAL_CONNECTION') throw new OAuthFlowFailure('INTERNAL', 'target_params');
    return parsed.data;
  }

  private priorCredentials(encrypted: string): Record<string, unknown> | null {
    try {
      const value: unknown = JSON.parse(this.cipher.decrypt(encrypted));
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private stateInvalid() {
    return oauthError(400, 'OAUTH_STATE_INVALID');
  }

  private async auditFailure(row: OauthState, reason: string, detail: string): Promise<void> {
    await this.audit(row.studioId, row.userId, 'integration.oauth.failed', row.id, {
      provider: row.provider,
      targetKind: row.targetKind,
      reason,
      detail: sanitizeProviderCode(detail),
      via: row.returnTo,
    });
  }

  private async audit(studioId: string, userId: string | null, action: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog.create({ data: { studioId, userId, action, entityType: 'integration', entityId, metadata: metadata as Prisma.InputJsonValue } });
  }
}
