import { Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AppearancePreferenceSchema, UpdateTenantThemeSchema } from '@platform/shared';
import type { AppearancePreference, UpdateTenantThemeInput } from '@platform/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { AppearanceService } from './appearance.service';

/** The signed-in user's own theme family and light/dark choice. */
@Controller('me/appearance')
@UseGuards(JwtAuthGuard)
export class MeAppearanceController {
  constructor(private readonly appearance: AppearanceService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    return this.appearance.getForUser(user.id);
  }

  @Put()
  async update(@CurrentUser() user: AuthUser, @ZodBody(AppearancePreferenceSchema) body: AppearancePreference) {
    return this.appearance.updateForUser(user.id, body);
  }
}

/** A studio's default theme family and brand. */
@Controller('studios/:studioId/theme')
@StudioScoped()
export class StudioThemeController {
  constructor(private readonly appearance: AppearanceService) {}

  @Get()
  @RequirePermission('studio.settings.view')
  async get(@Tenant() tenant: TenantContext) {
    return this.appearance.getForStudio(tenant.studioId);
  }

  @Put()
  @RequirePermission('studio.settings.manage')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateTenantThemeSchema) body: UpdateTenantThemeInput,
  ) {
    return this.appearance.updateForStudio(tenant.studioId, user.id, body);
  }
}
