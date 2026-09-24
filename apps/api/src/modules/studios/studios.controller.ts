import { Controller, Get, Param, Put, UseGuards, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { StudiosService } from './studios.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';

const UpdateEmbedSettingsSchema = z.object({
  /** Empty list means any origin may frame /embed/<slug> (frame-ancestors *). */
  embedAllowedOrigins: z.array(z.string().url()).max(20),
});
type UpdateEmbedSettingsInput = z.infer<typeof UpdateEmbedSettingsSchema>;

@Controller('studios')
export class StudiosController {
  constructor(private studiosService: StudiosService) {}

  /** Platform-wide listing: super-admin only. */
  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@CurrentUser() user: AuthUser) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }
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
