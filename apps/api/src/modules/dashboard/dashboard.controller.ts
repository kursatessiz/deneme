import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { DashboardDataRequestSchema, DashboardLayoutSchema } from '@platform/shared';
import type { DashboardDataRequest, DashboardLayout } from '@platform/shared';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { AllowWhenRestricted, RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { DashboardDataService } from './dashboard-data.service';
import { DashboardLayoutService } from './dashboard-layout.service';

/**
 * The overview page's card board (docs/WEB_PANEL.md, "Genel bakış
 * kartları"). The layout is the caller's own (one per membership); the
 * data endpoint checks each card's own permissions and returns
 * `forbidden` for a card the caller may not see.
 *
 * The writes stay open in billing restricted mode (@AllowWhenRestricted):
 * a layout is the caller's own screen preference and the data POST only
 * reads, and the overview page is where a restricted studio sees its
 * billing banner.
 */
@Controller('studios/:studioId/dashboard')
@StudioScoped()
export class DashboardController {
  constructor(
    private readonly layouts: DashboardLayoutService,
    private readonly data: DashboardDataService,
  ) {}

  @Get('layout')
  @RequirePermission('dashboard.view')
  getLayout(@Tenant() tenant: TenantContext) {
    return this.layouts.get(tenant);
  }

  /** Stores the board after clamping sizes, compacting and dropping cards the caller may not see. */
  @Put('layout')
  @RequirePermission('dashboard.view')
  @AllowWhenRestricted()
  saveLayout(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(DashboardLayoutSchema) body: DashboardLayout) {
    return this.layouts.save(tenant, user.id, body);
  }

  /** Back to the permission based default board. */
  @Delete('layout')
  @RequirePermission('dashboard.view')
  @AllowWhenRestricted()
  resetLayout(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.layouts.reset(tenant, user.id);
  }

  @Post('data')
  @HttpCode(200)
  @RequirePermission('dashboard.view')
  @AllowWhenRestricted()
  getData(@Tenant() tenant: TenantContext, @ZodBody(DashboardDataRequestSchema) body: DashboardDataRequest) {
    return this.data.compute(tenant, body);
  }
}
