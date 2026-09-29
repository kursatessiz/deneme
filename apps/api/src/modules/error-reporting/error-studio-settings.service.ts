import { Injectable } from '@nestjs/common';
import type { StudioErrorSettingsDTO } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The tenant's error notification opt-in (H3): whether the owner is e-mailed
 * when a new error group or a spike affects the studio's users. Off until the
 * owner turns it on (a missing row means off).
 */
@Injectable()
export class ErrorStudioSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(studioId: string): Promise<StudioErrorSettingsDTO> {
    const row = await this.prisma.errorStudioSetting.findUnique({ where: { studioId }, select: { ownerNotify: true } });
    return { ownerNotify: row?.ownerNotify ?? false };
  }

  async update(studioId: string, userId: string, ownerNotify: boolean): Promise<StudioErrorSettingsDTO> {
    await this.prisma.errorStudioSetting.upsert({
      where: { studioId },
      create: { studioId, ownerNotify, updatedByUserId: userId },
      update: { ownerNotify, updatedByUserId: userId },
    });
    await this.prisma.auditLog.create({
      data: { studioId, userId, action: 'error_studio_settings.update', entityType: 'ErrorStudioSetting', entityId: studioId, metadata: { ownerNotify } },
    });
    return { ownerNotify };
  }
}
