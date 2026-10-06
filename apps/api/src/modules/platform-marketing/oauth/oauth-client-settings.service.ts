import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import { z } from 'zod';
import {
  OAUTH_PROVIDERS,
  OAUTH_PROVIDER_DEFINITIONS,
  oauthClientIssues,
  type OAuthClientSettingsDTO,
  type OAuthProvider,
  type SetOAuthClientInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialCipher } from '../../../common/crypto/credential-cipher';
import { last4, maskSecret } from './oauth-crypto';
import { apiError, codedError } from '../../../common/api-error';

const SETTINGS_ID = 'platform';

/** Masked, non-secret metadata kept next to each provider's encrypted blob. */
const StoredClientSchema = z.object({
  encrypted: z.string().min(1),
  clientIdLast4: z.string().max(4).nullable(),
  clientSecretLast4: z.string().max(4).nullable(),
  scopes: z.array(z.string()).default([]),
  configIdSet: z.boolean().default(false),
  developerTokenLast4: z.string().max(4).nullable().default(null),
  updatedAt: z.string(),
  updatedByUserId: z.string().nullable().default(null),
});
type StoredClient = z.infer<typeof StoredClientSchema>;

/** The decrypted part: never leaves the service layer, never logged, never returned. */
const ClientSecretsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  configId: z.string().nullable().optional(),
  developerToken: z.string().optional(),
});

export interface ResolvedOAuthClient {
  clientId: string;
  clientSecret: string;
  configId: string | null;
  developerToken: string | null;
  scopes: readonly string[];
}

/**
 * OAuth client ids and secrets per provider (M4a): super admin settings in
 * platform_integration_settings.oauth_clients, one CredentialCipher blob per
 * provider plus masked metadata. Never an environment variable; responses
 * carry the last four characters at most. Every change is audit-logged
 * (`integration.oauth.client_set` / `client_removed`) without the values.
 */
@Injectable()
export class OAuthClientSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly config: ConfigService,
  ) {}

  async list(): Promise<OAuthClientSettingsDTO[]> {
    const stored = await this.readAll();
    return OAUTH_PROVIDERS.map((provider) => this.toDto(provider, stored[provider] ?? null));
  }

  /** Which providers have a usable client (id, secret and every required extra). */
  async configuredProviders(): Promise<Set<OAuthProvider>> {
    const stored = await this.readAll();
    return new Set(OAUTH_PROVIDERS.filter((p) => this.isComplete(p, stored[p] ?? null)));
  }

  async set(provider: OAuthProvider, userId: string, input: SetOAuthClientInput): Promise<OAuthClientSettingsDTO> {
    if (this.config.get<string>('NODE_ENV') === 'production' && !this.cipher.isConfigured) {
      throw new BadRequestException(apiError('apiErrors.platformMarketing.oauthClientCannotSavedProductionUntil'));
    }
    const stored = await this.readAll();
    const current = stored[provider] ?? null;
    const prior = current ? this.decrypt(current) : null;
    const issues = oauthClientIssues(provider, input, { hasSecret: Boolean(prior?.clientSecret), hasDeveloperToken: Boolean(prior?.developerToken) });
    if (issues.length > 0) throw new BadRequestException(codedError('OAUTH_CLIENT_INVALID', { statusCode: 400, issues }));

    const def = OAUTH_PROVIDER_DEFINITIONS[provider];
    const secrets = {
      clientId: input.clientId,
      clientSecret: input.clientSecret ?? prior?.clientSecret ?? '',
      configId: def.extraFields.includes('configId') ? (input.configId === undefined ? (prior?.configId ?? null) : input.configId) : null,
      ...(def.extraFields.includes('developerToken') ? { developerToken: input.developerToken ?? prior?.developerToken } : {}),
    };
    const record: StoredClient = {
      encrypted: this.cipher.encrypt(JSON.stringify(secrets)),
      clientIdLast4: last4(secrets.clientId),
      clientSecretLast4: last4(secrets.clientSecret),
      scopes: input.scopes ?? current?.scopes ?? [],
      configIdSet: Boolean(secrets.configId),
      developerTokenLast4: last4(secrets.developerToken ?? null),
      updatedAt: new Date().toISOString(),
      updatedByUserId: userId,
    };
    await this.write({ ...stored, [provider]: record }, userId);
    await this.prisma.auditLog.create({
      data: {
        studioId: null,
        userId,
        action: 'integration.oauth.client_set',
        entityType: 'integration',
        entityId: provider,
        metadata: { provider, secretReplaced: input.clientSecret !== undefined, scopes: record.scopes.length, configIdSet: record.configIdSet } as Prisma.InputJsonValue,
      },
    });
    return this.toDto(provider, record);
  }

  async remove(provider: OAuthProvider, userId: string): Promise<OAuthClientSettingsDTO> {
    const stored = await this.readAll();
    if (!stored[provider]) throw new NotFoundException(apiError('apiErrors.platformMarketing.oauthClientNotRegistered'));
    const next = { ...stored };
    delete next[provider];
    await this.write(next, userId);
    await this.prisma.auditLog.create({
      data: { studioId: null, userId, action: 'integration.oauth.client_removed', entityType: 'integration', entityId: provider, metadata: { provider } },
    });
    return this.toDto(provider, null);
  }

  /** The decrypted client for the flow, or null when it is not (completely) configured. */
  async resolve(provider: OAuthProvider): Promise<ResolvedOAuthClient | null> {
    const stored = (await this.readAll())[provider] ?? null;
    if (!stored || !this.isComplete(provider, stored)) return null;
    const secrets = this.decrypt(stored);
    if (!secrets) return null;
    const def = OAUTH_PROVIDER_DEFINITIONS[provider];
    return {
      clientId: secrets.clientId,
      clientSecret: secrets.clientSecret,
      configId: secrets.configId ?? null,
      developerToken: secrets.developerToken ?? null,
      scopes: stored.scopes.length > 0 ? stored.scopes.filter((s) => def.allowedScopes.includes(s)) : def.defaultScopes,
    };
  }

  private isComplete(provider: OAuthProvider, stored: StoredClient | null): boolean {
    if (!stored?.clientIdLast4 || !stored.clientSecretLast4) return false;
    const def = OAUTH_PROVIDER_DEFINITIONS[provider];
    return !def.requiredExtraFields.includes('developerToken') || Boolean(stored.developerTokenLast4);
  }

  private decrypt(stored: StoredClient): z.infer<typeof ClientSecretsSchema> | null {
    try {
      const parsed = ClientSecretsSchema.safeParse(JSON.parse(this.cipher.decrypt(stored.encrypted)));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private toDto(provider: OAuthProvider, stored: StoredClient | null): OAuthClientSettingsDTO {
    return {
      provider,
      configured: this.isComplete(provider, stored),
      clientIdPreview: stored?.clientIdLast4 ? maskSecret(stored.clientIdLast4) : null,
      clientSecretPreview: stored?.clientSecretLast4 ? maskSecret(stored.clientSecretLast4) : null,
      scopes: stored?.scopes ?? [],
      configIdSet: stored?.configIdSet ?? false,
      developerTokenPreview: stored?.developerTokenLast4 ? maskSecret(stored.developerTokenLast4) : null,
      updatedAt: stored?.updatedAt ?? null,
    };
  }

  private async readAll(): Promise<Partial<Record<OAuthProvider, StoredClient>>> {
    const row = await this.prisma.platformIntegrationSettings.findUnique({ where: { id: SETTINGS_ID }, select: { oauthClients: true } });
    const raw = row?.oauthClients;
    const out: Partial<Record<OAuthProvider, StoredClient>> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const provider of OAUTH_PROVIDERS) {
      const parsed = StoredClientSchema.safeParse((raw as Record<string, unknown>)[provider]);
      if (parsed.success) out[provider] = parsed.data;
    }
    return out;
  }

  private async write(clients: Partial<Record<OAuthProvider, StoredClient>>, userId: string): Promise<void> {
    const value = clients as unknown as Prisma.InputJsonValue;
    await this.prisma.platformIntegrationSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, oauthClients: value, updatedByUserId: userId },
      update: { oauthClients: value, updatedByUserId: userId },
    });
  }
}
