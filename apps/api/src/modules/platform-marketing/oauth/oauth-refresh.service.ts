import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type AdConnection, type SocialConnection } from '@platform/database';
import {
  OAUTH_HEALTH_CHECK_HOURS,
  OAUTH_MAX_REFRESH_PER_RUN,
  OAUTH_REFRESH_WINDOW_HOURS,
  OAUTH_STATE_RETENTION_HOURS,
  SocialCredentialsSchema,
  credentialLast4Of,
  oauthNextRefreshAt,
  oauthRefreshRetryDelayMs,
  type GoogleCredentials,
  type MetaCredentials,
  type OAuthProvider,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialCipher } from '../../../common/crypto/credential-cipher';
import { oauthProviderOf } from '../../social/social-connections.service';
import { OAuthClientSettingsService } from './oauth-client-settings.service';
import { OAuthCallError, OAuthProviderClient, type OAuthTokenSet } from './oauth-provider.client';

const HOUR = 60 * 60 * 1000;
/** A claimed row is invisible to a parallel run for this long (lease). */
const LEASE_MS = 10 * 60 * 1000;

export interface OAuthRefreshResult {
  refreshed: number;
  retrying: number;
  reauthRequired: number;
  statesPurged: number;
}

type Outcome = 'refreshed' | 'retrying' | 'reauthRequired';

/** Refresh is not possible for this connection (no refresh token, no client): a reconnect is the only way once it expires. */
class RefreshUnavailable extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Background refresh of OAuth tokens (M4a), one step of the 15-minute
 * heartbeat. It looks at OAuth connections whose next_refresh_at has come
 * (24 hours before expiry, or a daily health check for Google refresh
 * tokens) and: Google / LinkedIn use the refresh token grant, Meta
 * exchanges the still-valid long-lived token for a new one. A transient
 * failure (network, 5xx, 429) is retried with backoff and shows as
 * `lastError` on the hub; a permanent one (invalid_grant, revoked token),
 * running out of retries or an expired token marks the connection
 * REAUTH_REQUIRED, which the hub shows with a reconnect action. Pasted
 * connections (auth_method PASTED) are never touched. It also deletes old
 * OAuth states.
 */
@Injectable()
export class OAuthRefreshService {
  private readonly logger = new Logger(OAuthRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly clients: OAuthClientSettingsService,
    private readonly providers: OAuthProviderClient,
  ) {}

  async processDue(now = new Date()): Promise<OAuthRefreshResult> {
    const result: OAuthRefreshResult = { refreshed: 0, retrying: 0, reauthRequired: 0, statesPurged: 0 };
    const purged = await this.prisma.oauthState.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - OAUTH_STATE_RETENTION_HOURS * HOUR) } } });
    result.statesPurged = purged.count;

    const due = { authMethod: 'OAUTH', status: { not: 'REAUTH_REQUIRED' }, nextRefreshAt: { lte: now } } as const;
    const ads = await this.prisma.adConnection.findMany({ where: due, orderBy: { nextRefreshAt: 'asc' }, take: OAUTH_MAX_REFRESH_PER_RUN });
    for (const row of ads) {
      if (!(await this.claimAd(row, now))) continue;
      result[await this.refreshAd(row, now)] += 1;
    }
    const socials = await this.prisma.socialConnection.findMany({
      where: { authMethod: 'OAUTH', status: { not: 'REAUTH_REQUIRED' }, nextRefreshAt: { lte: now } },
      orderBy: { nextRefreshAt: 'asc' },
      take: OAUTH_MAX_REFRESH_PER_RUN,
    });
    for (const row of socials) {
      if (!(await this.claimSocial(row, now))) continue;
      result[await this.refreshSocial(row, now)] += 1;
    }
    return result;
  }

  // -- Ad connections (Meta long-lived token, Google refresh token) --

  private async refreshAd(row: AdConnection, now: Date): Promise<Outcome> {
    const provider = oauthProviderOf(row.oauthProvider);
    try {
      if (provider === 'META') {
        const client = await this.clients.resolve('META');
        if (!client) throw new RefreshUnavailable('client_missing');
        const credentials = JSON.parse(this.cipher.decrypt(row.encryptedCredentials)) as MetaCredentials;
        const tokens = await this.providers.metaLongLived(client, credentials.accessToken);
        const next: MetaCredentials = { ...credentials, accessToken: tokens.accessToken };
        const tokenExpiresAt = tokens.expiresInSec ? new Date(now.getTime() + tokens.expiresInSec * 1000) : null;
        await this.prisma.adConnection.update({
          where: { id: row.id },
          data: {
            encryptedCredentials: this.cipher.encrypt(JSON.stringify(next)),
            credentialLast4: credentialLast4Of('META', next),
            tokenExpiresAt,
            ...this.success(row.lastError, 'META', tokenExpiresAt, false, now),
          },
        });
        return 'refreshed';
      }
      if (provider === 'GOOGLE') {
        const credentials = JSON.parse(this.cipher.decrypt(row.encryptedCredentials)) as GoogleCredentials;
        const refreshToken = row.encryptedRefreshToken ? this.cipher.decrypt(row.encryptedRefreshToken) : credentials.refreshToken;
        // The grant belongs to the client that issued it: the one saved with the connection.
        const tokens = await this.providers.refreshGrant('GOOGLE', { clientId: credentials.clientId, clientSecret: credentials.clientSecret }, refreshToken);
        const rotated = tokens.refreshToken ?? refreshToken;
        const next: GoogleCredentials = { ...credentials, refreshToken: rotated };
        const tokenExpiresAt = tokens.refreshExpiresInSec ? new Date(now.getTime() + tokens.refreshExpiresInSec * 1000) : row.tokenExpiresAt;
        await this.prisma.adConnection.update({
          where: { id: row.id },
          data: {
            encryptedCredentials: this.cipher.encrypt(JSON.stringify(next)),
            credentialLast4: credentialLast4Of('GOOGLE', next),
            encryptedRefreshToken: this.cipher.encrypt(rotated),
            tokenExpiresAt,
            ...this.success(row.lastError, 'GOOGLE', tokenExpiresAt, true, now),
          },
        });
        return 'refreshed';
      }
      throw new RefreshUnavailable('provider_unknown');
    } catch (err) {
      return this.failure('ad', row, provider, err, now);
    }
  }

  // -- Social connections (LinkedIn refresh token; Meta page tokens do not expire) --

  private async refreshSocial(row: SocialConnection, now: Date): Promise<Outcome> {
    const provider = oauthProviderOf(row.oauthProvider);
    try {
      if (provider !== 'LINKEDIN' || !row.encryptedRefreshToken) throw new RefreshUnavailable('no_refresh_token');
      const client = await this.clients.resolve('LINKEDIN');
      if (!client) throw new RefreshUnavailable('client_missing');
      const refreshToken = this.cipher.decrypt(row.encryptedRefreshToken);
      const tokens: OAuthTokenSet = await this.providers.refreshGrant('LINKEDIN', client, refreshToken);
      const credentials = SocialCredentialsSchema.parse({ ...SocialCredentialsSchema.parse(JSON.parse(this.cipher.decrypt(row.encryptedCredentials))), accessToken: tokens.accessToken });
      const tokenExpiresAt = tokens.expiresInSec ? new Date(now.getTime() + tokens.expiresInSec * 1000) : null;
      await this.prisma.socialConnection.update({
        where: { id: row.id },
        data: {
          encryptedCredentials: this.cipher.encrypt(JSON.stringify(credentials)),
          credentialLast4: credentials.accessToken.slice(-4),
          encryptedRefreshToken: this.cipher.encrypt(tokens.refreshToken ?? refreshToken),
          tokenExpiresAt,
          status: 'CONNECTED',
          ...this.success(row.lastError, 'LINKEDIN', tokenExpiresAt, true, now),
        },
      });
      return 'refreshed';
    } catch (err) {
      return this.failure('social', row, provider, err, now);
    }
  }

  // -- Shared outcome handling --

  private success(lastError: string | null, provider: OAuthProvider, tokenExpiresAt: Date | null, hasRefreshToken: boolean, now: Date) {
    let next = oauthNextRefreshAt(provider, tokenExpiresAt, hasRefreshToken, now);
    // A token whose expiry did not move (a time-limited Google grant) is looked at again at expiry, not every run.
    if (next && next.getTime() <= now.getTime()) next = tokenExpiresAt && tokenExpiresAt > now ? tokenExpiresAt : new Date(now.getTime() + OAUTH_REFRESH_WINDOW_HOURS * HOUR);
    return {
      refreshAttempts: 0,
      nextRefreshAt: next,
      // Only an error this job wrote is cleared; a sync or publish error stays until its own success.
      ...(lastError?.startsWith('OAUTH_') ? { lastError: null } : {}),
    };
  }

  private async failure(kind: 'ad' | 'social', row: AdConnection | SocialConnection, provider: OAuthProvider | null, err: unknown, now: Date): Promise<Outcome> {
    const code = err instanceof OAuthCallError ? err.code : err instanceof RefreshUnavailable ? err.code : 'unexpected';
    const transient = err instanceof OAuthCallError && err.kind === 'TRANSIENT';
    const attempts = row.refreshAttempts + 1;
    const expired = row.tokenExpiresAt !== null && row.tokenExpiresAt.getTime() <= now.getTime();
    const delay = transient ? oauthRefreshRetryDelayMs(attempts) : null;
    if (!(err instanceof OAuthCallError) && !(err instanceof RefreshUnavailable)) this.logger.error(`OAuth refresh of ${kind} connection ${row.id} failed unexpectedly`);

    // No refresh path yet a valid token: warn on the hub and look again when it expires.
    if (err instanceof RefreshUnavailable && !expired && row.tokenExpiresAt) {
      await this.update(kind, row.id, { lastError: `OAUTH_REFRESH_UNAVAILABLE: ${code}`, refreshAttempts: attempts, nextRefreshAt: row.tokenExpiresAt });
      await this.audit(row, 'integration.oauth.refresh_failed', { provider, code, transient: false });
      return 'retrying';
    }
    if (delay !== null && !expired) {
      const nextAt = new Date(Math.min(now.getTime() + delay, row.tokenExpiresAt ? row.tokenExpiresAt.getTime() : Number.MAX_SAFE_INTEGER));
      await this.update(kind, row.id, { lastError: `OAUTH_REFRESH_FAILED: ${code}`, refreshAttempts: attempts, nextRefreshAt: nextAt });
      await this.audit(row, 'integration.oauth.refresh_failed', { provider, code, transient: true, attempt: attempts });
      return 'retrying';
    }
    // The job skips REAUTH_REQUIRED rows; a schedule is kept so that, should a connection test or a publish
    // put the row back to CONNECTED without a reconnect, the job picks it up again instead of forgetting it.
    await this.update(kind, row.id, {
      status: 'REAUTH_REQUIRED',
      lastError: `OAUTH_REAUTH_REQUIRED: ${code}`,
      refreshAttempts: 0,
      nextRefreshAt: new Date(now.getTime() + OAUTH_HEALTH_CHECK_HOURS * HOUR),
    });
    await this.audit(row, 'integration.oauth.reauth_required', { provider, code, attempts });
    return 'reauthRequired';
  }

  private async update(kind: 'ad' | 'social', id: string, data: { status?: 'REAUTH_REQUIRED'; lastError: string; refreshAttempts: number; nextRefreshAt: Date | null }): Promise<void> {
    if (kind === 'ad') await this.prisma.adConnection.update({ where: { id }, data });
    else await this.prisma.socialConnection.update({ where: { id }, data });
  }

  /** Optimistic claim: moves next_refresh_at forward only if nobody else did since it was read. */
  private async claimAd(row: AdConnection, now: Date): Promise<boolean> {
    const claimed = await this.prisma.adConnection.updateMany({ where: { id: row.id, nextRefreshAt: row.nextRefreshAt }, data: { nextRefreshAt: new Date(now.getTime() + LEASE_MS) } });
    return claimed.count === 1;
  }

  private async claimSocial(row: SocialConnection, now: Date): Promise<boolean> {
    const claimed = await this.prisma.socialConnection.updateMany({ where: { id: row.id, nextRefreshAt: row.nextRefreshAt }, data: { nextRefreshAt: new Date(now.getTime() + LEASE_MS) } });
    return claimed.count === 1;
  }

  private async audit(row: AdConnection | SocialConnection, action: string, metadata: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog.create({
      data: { studioId: row.studioId, userId: null, action, entityType: 'integration', entityId: row.id, metadata: metadata as Prisma.InputJsonValue },
    });
  }
}
