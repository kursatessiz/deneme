import { Injectable } from '@nestjs/common';
import { isThemeFamilyAllowed } from '@platform/shared';
import type { AppearancePreference, TenantTheme, TenantThemeView } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toAppearance, toTenantTheme } from './theme-mapping';
import { loadAllowedThemeFamiliesForStudio } from './theme-families';
import { themeFamilyNotAllowed } from './theme-family.errors';

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

  /** The stored theme plus the families the super admin allowed for this studio. */
  async getForStudio(studioId: string): Promise<TenantThemeView> {
    const [studio, allowedThemeFamilies] = await Promise.all([
      this.prisma.studio.findUniqueOrThrow({
        where: { id: studioId },
        select: { logoUrl: true, themeFamily: true, themePrimary: true, gradientPresetKey: true },
      }),
      loadAllowedThemeFamiliesForStudio(this.prisma, studioId),
    ]);
    return { ...toTenantTheme(studio), allowedThemeFamilies };
  }

  /**
   * Saves the studio's logo and primary color, and its family when it is one
   * the super admin allowed. Re-sending the stored family unchanged is always
   * accepted (clients echo it back), so a studio whose stored family is not
   * allowed can still edit its logo and color; changing to a family outside
   * the allow-list is a 403.
   */
  async updateForStudio(studioId: string, actorUserId: string, input: TenantTheme): Promise<TenantThemeView> {
    const before = await this.getForStudio(studioId);
    if (input.themeFamily !== before.themeFamily && !isThemeFamilyAllowed(input.themeFamily, before.allowedThemeFamilies)) {
      throw themeFamilyNotAllowed();
    }
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
    return { ...toTenantTheme(studio), allowedThemeFamilies: before.allowedThemeFamilies };
  }
}
