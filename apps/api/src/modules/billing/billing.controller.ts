import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ActivateStudioSchema } from '@platform/shared';
import type { ActivateStudioInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { PlatformBillingService } from './platform-billing.service';
import { StudioReferralsService } from './studio-referrals.service';

/**
 * The tenant's own platform account (G5c-1): trial and plan summary,
 * activation, platform payments and the business referral page. Owner
 * only (billing.manage is in OWNER_ONLY_PERMISSIONS) and on the
 * restricted-mode allow-list, so a restricted studio can always activate.
 */
@Controller('studios/:studioId')
@StudioScoped()
export class BillingController {
  constructor(
    private readonly billing: PlatformBillingService,
    private readonly referrals: StudioReferralsService,
  ) {}

  @Get('billing')
  @RequirePermission('billing.manage')
  summary(@Tenant() tenant: TenantContext) {
    return this.billing.summary(tenant.studioId);
  }

  @Get('billing/payments')
  @RequirePermission('billing.manage')
  async payments(@Tenant() tenant: TenantContext) {
    return { items: await this.billing.listPayments(tenant.studioId) };
  }

  @Post('billing/activate')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  activate(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(ActivateStudioSchema) body: ActivateStudioInput) {
    return this.billing.activate(tenant, user.id, body);
  }

  @Get('business-referrals')
  @RequirePermission('billing.manage')
  referralOverview(@Tenant() tenant: TenantContext) {
    return this.referrals.overview(tenant.studioId);
  }
}
