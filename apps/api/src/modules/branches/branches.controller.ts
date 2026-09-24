import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  CreateBranchSchema,
  ReportRangeSchema,
  SetStaffBranchesSchema,
  UpdateBranchSchema,
} from '@platform/shared';
import type { CreateBranchInput, ReportRange, SetStaffBranchesInput, UpdateBranchInput } from '@platform/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { RequirePermission, SelfService, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { BranchesService } from './branches.service';

@Controller('branches')
@StudioScoped()
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  /** Members pick a branch when booking, so any active membership may list them. */
  @Get('studio/:studioId')
  @SelfService()
  async list(@Tenant() tenant: TenantContext) {
    return this.branches.list(tenant);
  }

  @Get('studio/:studioId/summary')
  @RequirePermission('reports.view')
  async summary(@Tenant() tenant: TenantContext, @ZodQuery(ReportRangeSchema) range: ReportRange) {
    return this.branches.summary(tenant, range);
  }

  @Post()
  @RequirePermission('branches.manage')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateBranchSchema) body: CreateBranchInput,
  ) {
    return this.branches.create(tenant, user.id, body);
  }

  @Patch(':branchId')
  @RequirePermission('branches.manage')
  async update(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateBranchSchema) body: UpdateBranchInput,
  ) {
    return this.branches.update(tenant, user.id, branchId, body);
  }

  @Get('staff/:membershipId')
  @RequirePermission('staff.manage')
  async getStaffBranches(@Param('membershipId', ParseUUIDPipe) membershipId: string, @Tenant() tenant: TenantContext) {
    return this.branches.getStaffBranches(tenant, membershipId);
  }

  @Put('staff/:membershipId')
  @RequirePermission('branches.manage')
  async setStaffBranches(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(SetStaffBranchesSchema) body: SetStaffBranchesInput,
  ) {
    return this.branches.setStaffBranches(tenant, user.id, membershipId, body);
  }
}

/**
 * Cross-studio view for people who run several businesses (franchise).
 * Not studio scoped: each studio is included only if the caller can read
 * its reports across all branches.
 */
@Controller('portfolio')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(private readonly branches: BranchesService) {}

  @Get('summary')
  async summary(@CurrentUser() user: AuthUser, @ZodQuery(ReportRangeSchema) range: ReportRange) {
    return this.branches.portfolio(user.id, range);
  }
}
