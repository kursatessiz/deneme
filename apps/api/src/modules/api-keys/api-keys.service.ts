import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateApiKey } from './api-key.util';
import type { CreateApiKeyInput } from '@platform/shared';
import type { TenantContext } from '../auth/tenant-context';

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  async create(tenant: TenantContext, userId: string, dto: CreateApiKeyInput) {
    const generated = generateApiKey();
    const apiKey = await this.prisma.apiKey.create({
      data: {
        studioId: tenant.studioId,
        name: dto.name,
        prefix: generated.prefix,
        secretHash: generated.secretHash,
        scopes: dto.scopes,
        createdByUserId: userId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId: tenant.studioId,
        userId,
        action: 'api_keys.create',
        entityType: 'ApiKey',
        entityId: apiKey.id,
        metadata: { name: apiKey.name, scopes: apiKey.scopes },
      },
    });
    // Plaintext is returned exactly once; callers must store it now.
    return { ...this.toListItem(apiKey), plaintext: generated.plaintext };
  }

  async list(tenant: TenantContext) {
    const keys = await this.prisma.apiKey.findMany({
      where: { studioId: tenant.studioId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => this.toListItem(k));
  }

  async revoke(tenant: TenantContext, userId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, studioId: tenant.studioId } });
    if (!key) throw new NotFoundException('API anahtarı bulunamadı');
    if (key.revokedAt) throw new BadRequestException('Bu anahtar zaten iptal edilmiş');
    const updated = await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({
      data: { studioId: tenant.studioId, userId, action: 'api_keys.revoke', entityType: 'ApiKey', entityId: id, metadata: {} },
    });
    return this.toListItem(updated);
  }

  private toListItem(key: { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date }) {
    return {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
    };
  }
}
