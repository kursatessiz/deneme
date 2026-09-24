import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PartnerConnectionStatus, Prisma } from '@platform/database';
import {
  parsePartnerConnectionConfig,
  DEFAULT_PARTNER_CONNECTION_CONFIG,
  type CreatePartnerConnectionInput,
  type PartnerConnectionConfig,
  type UpdatePartnerConnectionInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { CredentialCipher } from '../../common/crypto/credential-cipher';

/**
 * Public shape returned by every connections endpoint: credentials are
 * write-only and never echoed back, per CLAUDE.md rule 9 and the task
 * requirement that no endpoint ever return decrypted or encrypted
 * credentials.
 */
export interface PartnerConnectionSummary {
  id: string;
  provider: string;
  label: string;
  status: string;
  config: PartnerConnectionConfig;
  hasCredentials: boolean;
  lastSyncAt: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class PartnerConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly config: ConfigService,
  ) {}

  async list(tenant: TenantContext): Promise<PartnerConnectionSummary[]> {
    const rows = await this.prisma.partnerConnection.findMany({
      where: { studioId: tenant.studioId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toSummary(r));
  }

  async create(
    tenant: TenantContext,
    actorUserId: string,
    dto: CreatePartnerConnectionInput,
  ): Promise<PartnerConnectionSummary> {
    this.assertEncryptionAvailable();
    const config: PartnerConnectionConfig = { ...DEFAULT_PARTNER_CONNECTION_CONFIG, ...(dto.config ?? {}) };
    await this.assertCatalogReferencesValid(tenant.studioId, config);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.partnerConnection.create({
          data: {
            studioId: tenant.studioId,
            provider: dto.provider,
            label: dto.label,
            status: PartnerConnectionStatus.ACTIVE,
            encryptedCredentials: this.cipher.encrypt(JSON.stringify(dto.credentials)),
            config: config as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({
          data: {
            studioId: tenant.studioId,
            userId: actorUserId,
            action: 'partner_connection.create',
            entityType: 'PartnerConnection',
            entityId: row.id,
            metadata: { provider: dto.provider, label: dto.label },
          },
        });
        return row;
      });
      return this.toSummary(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bu sağlayıcı ve etiketle bir bağlantı zaten var');
      }
      throw err;
    }
  }

  async update(
    tenant: TenantContext,
    actorUserId: string,
    connectionId: string,
    dto: UpdatePartnerConnectionInput,
  ): Promise<PartnerConnectionSummary> {
    const existing = await this.prisma.partnerConnection.findFirst({
      where: { id: connectionId, studioId: tenant.studioId },
    });
    if (!existing) {
      throw new NotFoundException('Partner bağlantısı bulunamadı');
    }
    if (dto.credentials) {
      this.assertEncryptionAvailable();
    }

    const mergedConfig: PartnerConnectionConfig = dto.config
      ? { ...parsePartnerConnectionConfig(existing.config), ...dto.config }
      : parsePartnerConnectionConfig(existing.config);
    if (dto.config) {
      await this.assertCatalogReferencesValid(tenant.studioId, mergedConfig);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.partnerConnection.update({
        where: { id: connectionId },
        data: {
          label: dto.label ?? undefined,
          status: dto.status ?? undefined,
          config: dto.config ? (mergedConfig as unknown as Prisma.InputJsonValue) : undefined,
          encryptedCredentials: dto.credentials
            ? this.cipher.encrypt(JSON.stringify(dto.credentials))
            : undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'partner_connection.update',
          entityType: 'PartnerConnection',
          entityId: connectionId,
          metadata: { fields: Object.keys(dto) },
        },
      });
      return row;
    });
    return this.toSummary(updated);
  }

  async remove(tenant: TenantContext, actorUserId: string, connectionId: string): Promise<{ id: string }> {
    const existing = await this.prisma.partnerConnection.findFirst({
      where: { id: connectionId, studioId: tenant.studioId },
    });
    if (!existing) {
      throw new NotFoundException('Partner bağlantısı bulunamadı');
    }
    await this.prisma.$transaction([
      this.prisma.partnerConnection.delete({ where: { id: connectionId } }),
      this.prisma.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'partner_connection.delete',
          entityType: 'PartnerConnection',
          entityId: connectionId,
          metadata: { provider: existing.provider, label: existing.label },
        },
      }),
    ]);
    return { id: connectionId };
  }

  /** Internal use only (webhook/sync): decrypted credentials never leave the service layer. */
  async getDecryptedCredentials(connectionId: string): Promise<{ webhookSecret: string; apiKey?: string; apiSecret?: string; partnerAccountId?: string } | null> {
    const row = await this.prisma.partnerConnection.findUnique({ where: { id: connectionId } });
    if (!row?.encryptedCredentials) return null;
    return JSON.parse(this.cipher.decrypt(row.encryptedCredentials));
  }

  private assertEncryptionAvailable(): void {
    if (this.config.get<string>('NODE_ENV') === 'production' && !this.cipher.isConfigured) {
      throw new BadRequestException(
        'INTEGRATION_ENCRYPTION_KEY yapılandırılmadan üretimde partner kimlik bilgisi kaydedilemez',
      );
    }
  }

  private async assertCatalogReferencesValid(studioId: string, config: PartnerConnectionConfig): Promise<void> {
    if (config.serviceTypeIds.length > 0) {
      const found = await this.prisma.serviceType.count({
        where: { id: { in: config.serviceTypeIds }, studioId },
      });
      if (found !== config.serviceTypeIds.length) {
        throw new BadRequestException('Seçilen hizmet türlerinden biri bu işletmeye ait değil');
      }
    }
    if (config.branchIds.length > 0) {
      const found = await this.prisma.branch.count({ where: { id: { in: config.branchIds }, studioId } });
      if (found !== config.branchIds.length) {
        throw new BadRequestException('Seçilen şubelerden biri bu işletmeye ait değil');
      }
    }
  }

  private toSummary(row: {
    id: string;
    provider: string;
    label: string;
    status: string;
    config: Prisma.JsonValue;
    encryptedCredentials: string | null;
    lastSyncAt: Date | null;
    consecutiveFailures: number;
    createdAt: Date;
    updatedAt: Date;
  }): PartnerConnectionSummary {
    return {
      id: row.id,
      provider: row.provider,
      label: row.label,
      status: row.status,
      config: parsePartnerConnectionConfig(row.config),
      hasCredentials: row.encryptedCredentials !== null,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      consecutiveFailures: row.consecutiveFailures,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
