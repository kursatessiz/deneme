import { BadRequestException, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { UpdateMyLocaleSchema, UpdateStudioLocaleSchema, type UpdateMyLocaleInput, type UpdateStudioLocaleInput } from '@platform/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from './i18n.service';
import { apiError } from '../../common/api-error';

/** The signed-in user's own language choice; null follows the active studio's default. */
@Controller('me/locale')
@UseGuards(JwtAuthGuard)
export class MeLocaleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { locale: true } });
    return { locale: row.locale };
  }

  @Put()
  async update(@CurrentUser() user: AuthUser, @ZodBody(UpdateMyLocaleSchema) body: UpdateMyLocaleInput) {
    if (body.locale !== null && !(await this.i18n.isEnabledLocale(body.locale))) {
      throw new BadRequestException(apiError('apiErrors.i18n.languageNotEnabled', { locale: body.locale }));
    }
    const row = await this.prisma.user.update({ where: { id: user.id }, data: { locale: body.locale }, select: { locale: true } });
    return { locale: row.locale };
  }
}

/** A studio's default language for new/unlanguaged users. */
@Controller('studios/:studioId/locale')
@StudioScoped()
export class StudioLocaleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  @RequirePermission('studio.settings.view')
  async get(@Tenant() tenant: TenantContext) {
    const row = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { defaultLocale: true } });
    return { defaultLocale: row.defaultLocale };
  }

  @Put()
  @RequirePermission('studio.settings.manage')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateStudioLocaleSchema) body: UpdateStudioLocaleInput,
  ) {
    if (!(await this.i18n.isEnabledLocale(body.defaultLocale))) {
      throw new BadRequestException(apiError('apiErrors.i18n.languageNotEnabled', { locale: body.defaultLocale }));
    }
    const before = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { defaultLocale: true } });
    const [row] = await this.prisma.$transaction([
      this.prisma.studio.update({ where: { id: tenant.studioId }, data: { defaultLocale: body.defaultLocale }, select: { defaultLocale: true } }),
      this.prisma.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: user.id,
          action: 'studio.locale.update',
          entityType: 'Studio',
          entityId: tenant.studioId,
          metadata: { before: before.defaultLocale, after: body.defaultLocale },
        },
      }),
    ]);
    return { defaultLocale: row.defaultLocale };
  }
}
