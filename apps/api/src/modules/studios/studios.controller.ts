import { Controller, Get, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { StudiosService } from './studios.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';

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
}
