import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import {
  credentialLast4Of,
  validateCredentialsFor,
  type AdConnectionCredentials,
  type AdConnectionDTO,
  type AdConnectionPlatform,
  type ConversionActionMap,
  type CreateAdConnectionInput,
  type GoogleCredentials,
  type UpdateAdConnectionInput,
} from '@platform/shared';
import type { ConversionEventType } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../auth/tenant-context';
import { CredentialCipher } from '../../../common/crypto/credential-cipher';

/**
 * Extracts the pixel/dataset id the connection needs for delivery and (for
 * Meta/Google) for the public browser pixel, per platform. For Google this
 * is the public "AW-XXXXXXXXX" tag id (not a secret), used only to load
 * gtag on public pages -- never the OAuth credentials.
 */
function pixelOrDatasetIdOf(platform: AdConnectionPlatform, credentials: AdConnectionCredentials): string | null {
  if (platform === 'META') return (credentials as { pixelId: string }).pixelId;
  if (platform === 'GOOGLE') return (credentials as GoogleCredentials).conversionId;
  if (platform === 'TIKTOK') return (credentials as { pixelCode: string }).pixelCode;
  return null;
}

@Injectable()
export class AdConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly config: ConfigService,
  ) {}

  async list(tenant: TenantContext): Promise<AdConnectionDTO[]> {
    const rows = await this.prisma.adConnection.findMany({ where: { studioId: tenant.studioId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toDto);
  }

  async create(tenant: TenantContext, actorUserId: string, dto: CreateAdConnectionInput): Promise<AdConnectionDTO> {
    this.assertEncryptionAvailable();
    const credentials = dto.credentials as AdConnectionCredentials;
    const parsed = validateCredentialsFor(dto.platform, credentials);
    if (!parsed.success) throw new BadRequestException('Bu platform için kimlik bilgileri eksik veya geçersiz');

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.adConnection.create({
          data: {
            studioId: tenant.studioId,
            platform: dto.platform,
            label: dto.label,
            status: 'CONNECTED',
            externalAccountId: dto.externalAccountId,
            pixelOrDatasetId: pixelOrDatasetIdOf(dto.platform, credentials),
            encryptedCredentials: this.cipher.encrypt(JSON.stringify(credentials)),
            credentialLast4: credentialLast4Of(dto.platform, credentials),
            conversionActionIds: (dto.conversionActionIds ?? {}) as Prisma.InputJsonValue,
            isTestMode: dto.isTestMode,
          },
        });
        await tx.auditLog.create({
          data: {
            studioId: tenant.studioId,
            userId: actorUserId,
            action: 'ad_connection.create',
            entityType: 'AdConnection',
            entityId: row.id,
            metadata: { platform: dto.platform, label: dto.label },
          },
        });
        return row;
      });
      return toDto(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bu platform ve etiketle bir bağlantı zaten var');
      }
      throw err;
    }
  }

  async update(tenant: TenantContext, actorUserId: string, connectionId: string, dto: UpdateAdConnectionInput): Promise<AdConnectionDTO> {
    const existing = await this.findOwned(tenant.studioId, connectionId);
    if (dto.credentials) this.assertEncryptionAvailable();

    const platform = existing.platform as AdConnectionPlatform;
    let credentials: AdConnectionCredentials | null = null;
    if (dto.credentials) {
      const parsed = validateCredentialsFor(platform, dto.credentials);
      if (!parsed.success) throw new BadRequestException('Bu platform için kimlik bilgileri eksik veya geçersiz');
      credentials = dto.credentials as AdConnectionCredentials;
    }

    const mergedActionIds = dto.conversionActionIds
      ? { ...(existing.conversionActionIds as ConversionActionMap), ...dto.conversionActionIds }
      : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.adConnection.update({
        where: { id: connectionId },
        data: {
          label: dto.label ?? undefined,
          externalAccountId: dto.externalAccountId ?? undefined,
          isTestMode: dto.isTestMode ?? undefined,
          conversionActionIds: mergedActionIds ? (mergedActionIds as Prisma.InputJsonValue) : undefined,
          ...(credentials
            ? {
                encryptedCredentials: this.cipher.encrypt(JSON.stringify(credentials)),
                credentialLast4: credentialLast4Of(platform, credentials),
                pixelOrDatasetId: pixelOrDatasetIdOf(platform, credentials),
                status: 'CONNECTED',
                lastError: null,
              }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'ad_connection.update',
          entityType: 'AdConnection',
          entityId: connectionId,
          metadata: { fields: Object.keys(dto) },
        },
      });
      return row;
    });
    return toDto(updated);
  }

  async remove(tenant: TenantContext, actorUserId: string, connectionId: string): Promise<{ id: string }> {
    const existing = await this.findOwned(tenant.studioId, connectionId);
    await this.prisma.$transaction([
      this.prisma.adConnection.delete({ where: { id: existing.id } }),
      this.prisma.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'ad_connection.delete',
          entityType: 'AdConnection',
          entityId: existing.id,
          metadata: { platform: existing.platform, label: existing.label },
        },
      }),
    ]);
    return { id: existing.id };
  }

  /** Internal use only (delivery dispatcher, spend sync, test-connection): decrypted credentials never leave the service layer. */
  async getDecryptedCredentials(connectionId: string): Promise<AdConnectionCredentials | null> {
    const row = await this.prisma.adConnection.findUnique({ where: { id: connectionId } });
    if (!row) return null;
    return JSON.parse(this.cipher.decrypt(row.encryptedCredentials)) as AdConnectionCredentials;
  }

  async markSyncOutcome(connectionId: string, outcome: { ok: true } | { ok: false; error: string }): Promise<void> {
    await this.prisma.adConnection.update({
      where: { id: connectionId },
      data: outcome.ok
        ? { status: 'CONNECTED', lastSyncAt: new Date(), lastError: null }
        : { status: 'ERROR', lastError: outcome.error.slice(0, 1000) },
    });
  }

  private async findOwned(studioId: string, connectionId: string) {
    const existing = await this.prisma.adConnection.findFirst({ where: { id: connectionId, studioId } });
    if (!existing) throw new NotFoundException('Reklam bağlantısı bulunamadı');
    return existing;
  }

  private assertEncryptionAvailable(): void {
    if (this.config.get<string>('NODE_ENV') === 'production' && !this.cipher.isConfigured) {
      throw new BadRequestException('INTEGRATION_ENCRYPTION_KEY yapılandırılmadan üretimde reklam bağlantısı kaydedilemez');
    }
  }
}

function toDto(row: {
  id: string;
  platform: string;
  label: string;
  status: string;
  externalAccountId: string;
  pixelOrDatasetId: string | null;
  conversionActionIds: Prisma.JsonValue;
  isTestMode: boolean;
  credentialLast4: string;
  lastSyncAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AdConnectionDTO {
  return {
    id: row.id,
    platform: row.platform as AdConnectionPlatform,
    label: row.label,
    status: row.status as AdConnectionDTO['status'],
    externalAccountId: row.externalAccountId,
    pixelOrDatasetId: row.pixelOrDatasetId,
    conversionActionIds: (row.conversionActionIds ?? {}) as Partial<Record<ConversionEventType, string>>,
    isTestMode: row.isTestMode,
    credentialLast4: row.credentialLast4,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
