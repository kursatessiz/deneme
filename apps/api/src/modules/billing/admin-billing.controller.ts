import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AdminForceBillingStatusSchema, ExtendTrialSchema, UpdatePlatformBillingSettingsSchema } from '@platform/shared';
import type { AdminForceBillingStatusInput, ExtendTrialInput, UpdatePlatformBillingSettingsInput } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { PlatformBillingService } from './platform-billing.service';
import { StudioReferralsService } from './studio-referrals.service';

/**
 * Super-admin side of platform billing (G5c-1): extend a trial, force a
 * studio ACTIVE or RESTRICTED (both audit logged), the referral reward
 * setting and the referral overview.
 */
@Controller('admin')
@SuperAdminOnly()
export class AdminBillingController {
  constructor(
    private readonly billing: PlatformBillingService,
    private readonly referrals: StudioReferralsService,
  ) {}

  @Post('tenants/:studioId/trial/extend')
  @HttpCode(200)
  extendTrial(@CurrentUser() user: AuthUser, @Param('studioId', ParseUUIDPipe) studioId: string, @ZodBody(ExtendTrialSchema) body: ExtendTrialInput) {
    return this.billing.extendTrial(user.id, studioId, body);
  }

  @Post('tenants/:studioId/billing-status')
  @HttpCode(200)
  forceStatus(
    @CurrentUser() user: AuthUser,
    @Param('studioId', ParseUUIDPipe) studioId: string,
    @ZodBody(AdminForceBillingStatusSchema) body: AdminForceBillingStatusInput,
  ) {
    return this.billing.forceStatus(user.id, studioId, body);
  }

  @Get('tenants/:studioId/billing')
  tenantBilling(@Param('studioId', ParseUUIDPipe) studioId: string) {
    return this.billing.summary(studioId);
  }

  @Get('billing/settings')
  async settings() {
    return { referralReward: await this.referrals.rewardSetting() };
  }

  @Put('billing/settings')
  updateSettings(@CurrentUser() user: AuthUser, @ZodBody(UpdatePlatformBillingSettingsSchema) body: UpdatePlatformBillingSettingsInput) {
    return this.referrals.updateSettings(user.id, body);
  }

  @Get('business-referrals')
  referralOverview() {
    return this.referrals.adminOverview();
  }
}
