import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ListReferralsQuerySchema, VoidReferralSchema } from '@platform/shared';
import type { ListReferralsQueryInput, VoidReferralInput } from '@platform/shared';
import { RequirePermission, SelfService, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ReferralsService } from './referrals.service';

@Controller('referrals/studio/:studioId')
@StudioScoped()
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('me/code')
  @SelfService()
  async myCode(@Tenant() tenant: TenantContext) {
    return this.referrals.myCode(tenant);
  }

  @Get('me')
  @SelfService()
  async myReferrals(@Tenant() tenant: TenantContext) {
    return this.referrals.myReferrals(tenant);
  }

  @Get()
  @RequirePermission('members.manage')
  async list(@Tenant() tenant: TenantContext, @ZodQuery(ListReferralsQuerySchema) query: ListReferralsQueryInput) {
    return this.referrals.list(tenant, query);
  }

  @Post(':referralId/reward')
  @RequirePermission('members.manage')
  async reward(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('referralId', ParseUUIDPipe) referralId: string) {
    return this.referrals.manualReward(tenant, user.id, referralId);
  }

  @Post(':referralId/void')
  @RequirePermission('members.manage')
  async void_(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('referralId', ParseUUIDPipe) referralId: string,
    @ZodBody(VoidReferralSchema) body: VoidReferralInput,
  ) {
    return this.referrals.voidReferral(tenant, user.id, referralId, body);
  }
}
