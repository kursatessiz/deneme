import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AssignPlanSchema, CreateTenantSchema } from '@platform/shared';
import type { AssignPlanInput, CreateTenantInput } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { AdminTenantsService } from './admin-tenants.service';

/**
 * Tenant CRUD, plan assignment and suspend/reactivate (backlog 4.1). No
 * tenant member personal data is exposed here beyond counts (CLAUDE.md
 * security note) - member/staff detail lives under the tenant's own
 * studio-scoped endpoints, which still require a real membership there.
 */
@Controller('admin/tenants')
@SuperAdminOnly()
export class AdminTenantsController {
  constructor(private readonly tenants: AdminTenantsService) {}

  @Get()
  async list() {
    return { items: await this.tenants.list() };
  }

  @Get(':studioId')
  async detail(@Param('studioId', ParseUUIDPipe) studioId: string) {
    return this.tenants.detail(studioId);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @ZodBody(CreateTenantSchema) body: CreateTenantInput) {
    return this.tenants.create(user.id, body);
  }

  @Post(':studioId/suspend')
  async suspend(@CurrentUser() user: AuthUser, @Param('studioId', ParseUUIDPipe) studioId: string) {
    return this.tenants.setActive(user.id, studioId, false);
  }

  @Post(':studioId/reactivate')
  async reactivate(@CurrentUser() user: AuthUser, @Param('studioId', ParseUUIDPipe) studioId: string) {
    return this.tenants.setActive(user.id, studioId, true);
  }

  @Post(':studioId/plan')
  async assignPlan(
    @CurrentUser() user: AuthUser,
    @Param('studioId', ParseUUIDPipe) studioId: string,
    @ZodBody(AssignPlanSchema) body: AssignPlanInput,
  ) {
    return this.tenants.assignPlan(user.id, studioId, body.planKey);
  }
}
