import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { MembersService } from './members.service';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { TenantContext } from '../auth/tenant-context';
import {
  CreateMemberSchema,
  CreateMemberInput,
  AssignPackageToMemberSchema,
  AssignPackageToMemberInput,
  FreezePackageSchema,
  FreezePackageInput,
} from '@platform/shared';

@Controller('members')
@StudioScoped()
export class MembersController {
  constructor(private membersService: MembersService) {}

  @Get('studio/:studioId')
  @RequirePermission('members.view')
  async findAll(@Tenant() tenant: TenantContext, @Query('search') search?: string) {
    return this.membersService.findAll(tenant, search);
  }

  @Get(':memberId/studio/:studioId')
  @RequirePermission('members.view')
  async findById(@Param('memberId') memberId: string, @Tenant() tenant: TenantContext) {
    return this.membersService.findById(memberId, tenant);
  }

  @Post()
  @RequirePermission('members.manage')
  async createMember(@Tenant() tenant: TenantContext, @ZodBody(CreateMemberSchema) body: CreateMemberInput) {
    return this.membersService.createMember(tenant, body);
  }

  @Post('packages/assign')
  @RequirePermission('packages.sell')
  async assignPackage(
    @Tenant() tenant: TenantContext,
    @ZodBody(AssignPackageToMemberSchema) body: AssignPackageToMemberInput,
  ) {
    return this.membersService.assignPackage(tenant, body);
  }

  @Post('packages/:packageId/freeze')
  @RequirePermission('packages.sell')
  async freezePackage(
    @Param('packageId') packageId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(FreezePackageSchema) body: FreezePackageInput,
  ) {
    return this.membersService.freezePackage(packageId, tenant, body);
  }
}
