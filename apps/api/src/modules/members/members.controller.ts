import { Controller, ForbiddenException, Get, Post, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { MembersService } from './members.service';
import { StudioScoped, RequirePermission, SelfService } from '../auth/decorators/require-permission.decorator';
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
  UnfreezePackageSchema,
  UnfreezePackageInput,
  SetHomeBranchSchema,
  SetHomeBranchInput,
} from '@platform/shared';

@Controller('members')
@StudioScoped()
export class MembersController {
  constructor(private membersService: MembersService) {}

  @Get('studio/:studioId')
  @RequirePermission('members.view')
  async findAll(
    @Tenant() tenant: TenantContext,
    @Query('search') search?: string,
    @Query('homeBranchId') homeBranchId?: string,
  ) {
    return this.membersService.findAll(tenant, search, homeBranchId);
  }

  @Put('self/home-branch')
  @SelfService()
  async setOwnHomeBranch(@Tenant() tenant: TenantContext, @ZodBody(SetHomeBranchSchema) body: SetHomeBranchInput) {
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işletmede üye profiliniz yok');
    return this.membersService.setHomeBranch(tenant, tenant.memberProfileId, body);
  }

  @Get('self/packages')
  @SelfService()
  async getSelfPackages(@Tenant() tenant: TenantContext, @Query('serviceTypeId') serviceTypeId?: string) {
    return this.membersService.getSelfPackages(tenant, serviceTypeId);
  }

  @Put(':memberId/home-branch')
  @RequirePermission('members.manage')
  async setHomeBranch(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(SetHomeBranchSchema) body: SetHomeBranchInput,
  ) {
    return this.membersService.setHomeBranch(tenant, memberId, body);
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

  @Post('packages/:packageId/unfreeze')
  @RequirePermission('packages.sell')
  async unfreezePackage(
    @Param('packageId') packageId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(UnfreezePackageSchema) body: UnfreezePackageInput,
  ) {
    return this.membersService.unfreezePackage(packageId, tenant, body);
  }
}
