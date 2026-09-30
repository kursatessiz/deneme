import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SocialConnection } from '@platform/database';
import {
  OAUTH_PROVIDERS,
  SOCIAL_ACTIVE_STATUSES,
  SocialCredentialsSchema,
  maskSecretPreview,
  type CreateSocialConnectionInput,
  type OAuthProvider,
  type SocialConnectionDTO,
  type SocialConnectionTestDTO,
  type SocialCredentials,
  type SocialProvider,
  type UpdateSocialConnectionInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { SocialPublishError } from './social-publisher';
import { SocialPublisherRegistry } from './social-publisher.registry';

export function socialError(code: string, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, code, message });
}

/**
 * Social connections of a tenant (the platform tenant today). Credentials
 * are pasted tokens or, since M4a, come from the OAuth flow
 * (platform-marketing/oauth): either way encrypted with CredentialCipher,
 * never returned; every DTO carries only a masked tail. The hub audits the
 * writes (integration.social.*); the publishing service reads the
 * decrypted credential through credentialsOf().
 */
@Injectable()
export class SocialConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly publishers: SocialPublisherRegistry,
  ) {}

  async list(studioId: string): Promise<SocialConnectionDTO[]> {
    const rows = await this.prisma.socialConnection.findMany({ where: { studioId }, orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((r) => this.toDto(r));
  }

  async get(studioId: string, id: string): Promise<SocialConnection> {
    const row = await this.prisma.socialConnection.findFirst({ where: { id, studioId } });
    if (!row) throw new NotFoundException('Sosyal hesap bulunamadı');
    return row;
  }

  async create(studioId: string, userId: string, input: CreateSocialConnectionInput): Promise<SocialConnectionDTO> {
    try {
      const row = await this.prisma.socialConnection.create({
        data: {
          studioId,
          provider: input.provider,
          externalId: input.externalId,
          displayName: input.displayName ?? input.externalId,
          encryptedCredentials: this.cipher.encrypt(JSON.stringify(input.credentials)),
          credentialLast4: input.credentials.accessToken.slice(-4),
          connectedByUserId: userId,
        },
      });
      return this.toDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw socialError('SOCIAL_CONNECTION_DUPLICATE', 'Bu hesap zaten bağlı');
      }
      throw err;
    }
  }

  /** Rename and/or replace the credential (a new credential clears the error state until the next test or publish). */
  async update(studioId: string, id: string, input: UpdateSocialConnectionInput): Promise<SocialConnectionDTO> {
    await this.get(studioId, id);
    const row = await this.prisma.socialConnection.update({
      where: { id },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.credentials
          ? {
              encryptedCredentials: this.cipher.encrypt(JSON.stringify(input.credentials)),
              credentialLast4: input.credentials.accessToken.slice(-4),
              status: 'CONNECTED' as const,
              lastError: null,
              // M4a: a pasted token replaces any OAuth grant; the refresh job leaves it alone.
              authMethod: 'PASTED',
              oauthProvider: null,
              tokenExpiresAt: null,
              encryptedRefreshToken: null,
              refreshAttempts: 0,
              nextRefreshAt: null,
            }
          : {}),
      },
    });
    return this.toDto(row);
  }

  /** A connection with pending, scheduled or publishing posts cannot go; finished posts leave with it. */
  async remove(studioId: string, id: string): Promise<{ id: string; provider: SocialProvider; externalId: string }> {
    const row = await this.get(studioId, id);
    const active = await this.prisma.socialPost.count({ where: { studioId, connectionId: id, status: { in: [...SOCIAL_ACTIVE_STATUSES] } } });
    if (active > 0) throw socialError('SOCIAL_CONNECTION_IN_USE', 'Bu hesabın bekleyen veya planlı gönderileri var');
    await this.prisma.socialConnection.delete({ where: { id } });
    return { id, provider: row.provider, externalId: row.externalId };
  }

  /** Reads the account name with the stored credential and records the outcome on the connection. */
  async test(studioId: string, id: string): Promise<SocialConnectionTestDTO> {
    const row = await this.get(studioId, id);
    try {
      const info = await this.publishers.for(row.provider).fetchAccount({ externalId: row.externalId, credentials: this.credentialsOf(row) });
      const updated = await this.prisma.socialConnection.update({
        where: { id },
        // A name the person typed is kept; the id placeholder is replaced by the real name.
        data: { status: 'CONNECTED', lastError: null, ...(row.displayName === row.externalId ? { displayName: info.displayName } : {}) },
      });
      return { ok: true, displayName: info.displayName, error: null, connection: this.toDto(updated) };
    } catch (err) {
      const message = err instanceof SocialPublishError ? err.message : 'The connection test failed';
      const updated = await this.prisma.socialConnection.update({ where: { id }, data: { status: 'ERROR', lastError: message } });
      return { ok: false, displayName: null, error: message, connection: this.toDto(updated) };
    }
  }

  /** Records the outcome of a real publish call on the connection (an authentication failure shows as ERROR). */
  async recordOutcome(id: string, outcome: { ok: true } | { ok: false; error: string; authFailure: boolean }): Promise<void> {
    if (outcome.ok) {
      await this.prisma.socialConnection.updateMany({ where: { id, OR: [{ status: 'ERROR' }, { lastError: { not: null } }] }, data: { status: 'CONNECTED', lastError: null } });
      return;
    }
    if (outcome.authFailure) await this.prisma.socialConnection.updateMany({ where: { id }, data: { status: 'ERROR', lastError: outcome.error } });
  }

  credentialsOf(row: Pick<SocialConnection, 'encryptedCredentials'>): SocialCredentials {
    return SocialCredentialsSchema.parse(JSON.parse(this.cipher.decrypt(row.encryptedCredentials)));
  }

  toDto(row: SocialConnection): SocialConnectionDTO {
    return {
      id: row.id,
      provider: row.provider,
      externalId: row.externalId,
      displayName: row.displayName,
      status: row.status,
      lastError: row.lastError,
      credentialPreview: maskSecretPreview(row.credentialLast4),
      connectedByUserId: row.connectedByUserId,
      authMethod: row.authMethod === 'OAUTH' ? 'OAUTH' : 'PASTED',
      oauthProvider: oauthProviderOf(row.oauthProvider),
      tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
      reauthRequired: row.status === 'REAUTH_REQUIRED',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** The stored provider name as an OAuthProvider, or null (pasted connections, unknown values). */
export function oauthProviderOf(value: string | null): OAuthProvider | null {
  return OAUTH_PROVIDERS.find((p) => p === value) ?? null;
}
