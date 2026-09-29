import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CreateFunnelSchema, FunnelReportQuerySchema, ReportRangeSchema, UpdateFunnelSchema } from '@platform/shared';
import type { CreateFunnelInput, FunnelReportQuery, ReportRange, UpdateFunnelInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { FunnelsService } from './funnels.service';

/**
 * Conversion funnels (G5d-1, docs/HUNILER.md). Viewing and reports reuse
 * `reports.view`; creating, editing and deleting tenant funnels needs
 * `funnels.manage`. The studio always comes from the tenant guard.
 */
@Controller('studios/:studioId/funnels')
@StudioScoped()
export class FunnelsController {
  constructor(private readonly funnels: FunnelsService) {}

  @Get()
  @RequirePermission('reports.view')
  async list(@Tenant() tenant: TenantContext) {
    return { items: await this.funnels.list(tenant) };
  }

  @Post()
  @RequirePermission('funnels.manage')
  create(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateFunnelSchema) body: CreateFunnelInput) {
    return this.funnels.create(tenant, user.id, body);
  }

  @Get(':id/report')
  @RequirePermission('reports.view')
  report(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @ZodQuery(ReportRangeSchema) range: ReportRange,
    @ZodQuery(FunnelReportQuerySchema) query: FunnelReportQuery,
  ) {
    return this.funnels.report(tenant, id, range, query);
  }

  @Patch(':id')
  @RequirePermission('funnels.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(UpdateFunnelSchema) body: UpdateFunnelInput,
  ) {
    return this.funnels.update(tenant, user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('funnels.manage')
  async remove(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.funnels.remove(tenant, user.id, id);
  }
}
