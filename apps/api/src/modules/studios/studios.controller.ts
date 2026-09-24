import { Controller, Get, Param, Put } from '@nestjs/common';
import { StudiosService } from './studios.service';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { UpdateEmbedSettingsSchema } from '@platform/shared';
import type { UpdateEmbedSettingsInput } from '@platform/shared';


@Controller('studios')
export class StudiosController {
  constructor(private studiosService: StudiosService) {}

  /** Platform-wide listing: super-admin only. */
  @Get()
  @SuperAdminOnly()
  async findAll() {
    return this.studiosService.findAll();
  }

  @Get('public/:slug')
  async findBySlug(@Param('slug') slug: string) {
    return this.studiosService.findBySlug(slug);
  }

  @Get(':studioId/metrics')
  @StudioScoped()
  @RequirePermission('reports.view')
  async getMetrics(@Tenant() tenant: TenantContext) {
    return this.studiosService.getDashboardMetrics(tenant.studioId);
  }

  /** The booking widget's current allowed embed origins (W18); empty allows any origin. */
  @Get(':studioId/embed-settings')
  @StudioScoped()
  @RequirePermission('integrations.manage')
  async getEmbedSettings(@Tenant() tenant: TenantContext) {
    return this.studiosService.getEmbedSettings(tenant.studioId);
  }

  /** The booking widget's allowed embed origins (W18); empty allows any origin. */
  @Put(':studioId/embed-settings')
  @StudioScoped()
  @RequirePermission('integrations.manage')
  async updateEmbedSettings(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateEmbedSettingsSchema) body: UpdateEmbedSettingsInput,
  ) {
    return this.studiosService.updateEmbedSettings(tenant.studioId, user.id, body.embedAllowedOrigins);
  }
}
