import { Injectable } from '@nestjs/common';
import type { AppearancePreference, TenantTheme } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toAppearance, toTenantTheme } from './theme-mapping';

@Injectable()
export class AppearanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getForUser(userId: string): Promise<AppearancePreference> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { themeFamily: true, colorScheme: true },
    });
    return toAppearance(user);
  }

  async updateForUser(userId: string, input: AppearancePreference): Promise<AppearancePreference> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { themeFamily: input.themeFamily, colorScheme: input.colorScheme },
      select: { themeFamily: true, colorScheme: true },
    });
    return toAppearance(user);
  }

  async getForStudio(studioId: string): Promise<TenantTheme> {
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: studioId },
      select: { logoUrl: true, themeFamily: true, themePrimary: true, gradientPresetKey: true },
    });
    return toTenantTheme(studio);
  }

  async updateForStudio(studioId: string, actorUserId: string, input: TenantTheme): Promise<TenantTheme> {
    const before = await this.getForStudio(studioId);
    const [studio] = await this.prisma.$transaction([
      this.prisma.studio.update({
        where: { id: studioId },
        data: {
          logoUrl: input.logoUrl,
          themeFamily: input.themeFamily,
          themePrimary: input.themePrimary,
          gradientPresetKey: input.gradientPresetKey,
        },
        select: { logoUrl: true, themeFamily: true, themePrimary: true, gradientPresetKey: true },
      }),
      this.prisma.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'studio.theme.update',
          entityType: 'Studio',
          entityId: studioId,
          metadata: { before, after: input },
        },
      }),
    ]);
    return toTenantTheme(studio);
  }
}
