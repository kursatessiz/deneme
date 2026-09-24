import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AssignRoleTemplateSchema, CreateRoleTemplateSchema, UpdateRoleTemplateSchema } from '@platform/shared';
import type { AssignRoleTemplateInput, CreateRoleTemplateInput, UpdateRoleTemplateInput } from '@platform/shared';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { RoleTemplatesService } from './role-templates.service';

/** Owner/manager screen: role templates (permission sets) and staff role assignment. See CLAUDE.md rule 5. */
@Controller('role-templates')
@StudioScoped()
export class RoleTemplatesController {
  constructor(private readonly roleTemplates: RoleTemplatesService) {}

  @Get('studio/:studioId')
  @RequirePermission('roles.manage')
  async list(@Tenant() tenant: TenantContext) {
    return this.roleTemplates.list(tenant);
  }

  @Post()
  @RequirePermission('roles.manage')
  async create(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateRoleTemplateSchema) body: CreateRoleTemplateInput) {
    return this.roleTemplates.create(tenant, user.id, body);
  }

  @Put(':roleTemplateId')
  @RequirePermission('roles.manage')
  async update(
    @Param('roleTemplateId', ParseUUIDPipe) roleTemplateId: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateRoleTemplateSchema) body: UpdateRoleTemplateInput,
  ) {
    return this.roleTemplates.update(tenant, user.id, roleTemplateId, body);
  }

  @Delete(':roleTemplateId')
  @RequirePermission('roles.manage')
  async remove(@Param('roleTemplateId', ParseUUIDPipe) roleTemplateId: string, @Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.roleTemplates.remove(tenant, user.id, roleTemplateId);
  }

  @Get('studio/:studioId/staff')
  @RequirePermission('roles.manage')
  async listStaff(@Tenant() tenant: TenantContext) {
    return this.roleTemplates.listStaff(tenant);
  }

  @Put('staff/:membershipId')
  @RequirePermission('roles.manage')
  async assignRole(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(AssignRoleTemplateSchema) body: AssignRoleTemplateInput,
  ) {
    return this.roleTemplates.assignRole(tenant, user.id, membershipId, body);
  }
}
