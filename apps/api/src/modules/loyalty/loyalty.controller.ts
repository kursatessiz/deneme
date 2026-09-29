import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  CreateLoyaltyRewardSchema,
  CreateLoyaltyRuleSchema,
  LoyaltyAdjustSchema,
  LoyaltyLedgerQuerySchema,
  LoyaltyRedeemSchema,
  UpdateLoyaltyRewardSchema,
  UpdateLoyaltyRuleSchema,
  UpdateLoyaltySettingsSchema,
} from '@platform/shared';
import type {
  CreateLoyaltyRewardInput,
  CreateLoyaltyRuleInput,
  LoyaltyAdjustInput,
  LoyaltyLedgerQuery,
  LoyaltyRedeemInput,
  UpdateLoyaltyRewardInput,
  UpdateLoyaltyRuleInput,
  UpdateLoyaltySettingsInput,
} from '@platform/shared';
import { RequirePermission, SelfService, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { LoyaltyService } from './loyalty.service';

/**
 * Loyalty points (G3a, docs/SADAKAT.md). The studio always comes from the
 * tenant guard; member ids are member profile ids of that studio.
 */
@Controller('studios/:studioId/loyalty')
@StudioScoped()
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  // -- Settings ---------------------------------------------------------------

  @Get('settings')
  @RequirePermission('loyalty.view')
  getSettings(@Tenant() tenant: TenantContext) {
    return this.loyalty.getSettings(tenant.studioId);
  }

  @Put('settings')
  @RequirePermission('loyalty.manage')
  updateSettings(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(UpdateLoyaltySettingsSchema) body: UpdateLoyaltySettingsInput) {
    return this.loyalty.updateSettings(tenant, user.id, body);
  }

  // -- Earn rules ---------------------------------------------------------------

  @Get('rules')
  @RequirePermission('loyalty.view')
  async listRules(@Tenant() tenant: TenantContext) {
    return { items: await this.loyalty.listRules(tenant.studioId) };
  }

  @Post('rules')
  @RequirePermission('loyalty.manage')
  createRule(@Tenant() tenant: TenantContext, @ZodBody(CreateLoyaltyRuleSchema) body: CreateLoyaltyRuleInput) {
    return this.loyalty.createRule(tenant.studioId, body);
  }

  @Patch('rules/:ruleId')
  @RequirePermission('loyalty.manage')
  updateRule(@Tenant() tenant: TenantContext, @Param('ruleId', ParseUUIDPipe) ruleId: string, @ZodBody(UpdateLoyaltyRuleSchema) body: UpdateLoyaltyRuleInput) {
    return this.loyalty.updateRule(tenant.studioId, ruleId, body);
  }

  @Delete('rules/:ruleId')
  @RequirePermission('loyalty.manage')
  async deleteRule(@Tenant() tenant: TenantContext, @Param('ruleId', ParseUUIDPipe) ruleId: string) {
    await this.loyalty.deleteRule(tenant.studioId, ruleId);
    return { deleted: true };
  }

  // -- Rewards --------------------------------------------------------------------

  @Get('rewards')
  @RequirePermission('loyalty.view')
  async listRewards(@Tenant() tenant: TenantContext) {
    return { items: await this.loyalty.listRewards(tenant.studioId) };
  }

  @Post('rewards')
  @RequirePermission('loyalty.manage')
  createReward(@Tenant() tenant: TenantContext, @ZodBody(CreateLoyaltyRewardSchema) body: CreateLoyaltyRewardInput) {
    return this.loyalty.createReward(tenant.studioId, body);
  }

  @Patch('rewards/:rewardId')
  @RequirePermission('loyalty.manage')
  updateReward(
    @Tenant() tenant: TenantContext,
    @Param('rewardId', ParseUUIDPipe) rewardId: string,
    @ZodBody(UpdateLoyaltyRewardSchema) body: UpdateLoyaltyRewardInput,
  ) {
    return this.loyalty.updateReward(tenant.studioId, rewardId, body);
  }

  @Delete('rewards/:rewardId')
  @RequirePermission('loyalty.manage')
  deleteReward(@Tenant() tenant: TenantContext, @Param('rewardId', ParseUUIDPipe) rewardId: string) {
    return this.loyalty.deleteReward(tenant.studioId, rewardId);
  }

  // -- Member card ------------------------------------------------------------------

  @Get('members/:memberId')
  @RequirePermission('loyalty.view')
  memberSummary(@Tenant() tenant: TenantContext, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.loyalty.memberSummary(tenant.studioId, memberId);
  }

  @Get('members/:memberId/ledger')
  @RequirePermission('loyalty.view')
  memberLedger(@Tenant() tenant: TenantContext, @Param('memberId', ParseUUIDPipe) memberId: string, @ZodQuery(LoyaltyLedgerQuerySchema) query: LoyaltyLedgerQuery) {
    return this.loyalty.memberLedger(tenant.studioId, memberId, query);
  }

  @Post('members/:memberId/adjust')
  @RequirePermission('loyalty.manage')
  adjust(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @ZodBody(LoyaltyAdjustSchema) body: LoyaltyAdjustInput,
  ) {
    return this.loyalty.adjust(tenant, user.id, memberId, body);
  }

  @Post('members/:memberId/redeem')
  @RequirePermission('loyalty.redeem')
  redeem(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @ZodBody(LoyaltyRedeemSchema) body: LoyaltyRedeemInput,
  ) {
    return this.loyalty.redeemForMember(tenant, user.id, memberId, body);
  }

  // -- Contact card --------------------------------------------------------------------

  @Get('contacts/:contactId/balance')
  @RequirePermission('loyalty.view')
  contactBalance(@Tenant() tenant: TenantContext, @Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.loyalty.contactBalance(tenant.studioId, contactId);
  }

  // -- Member self-service -------------------------------------------------------------------

  @Get('me')
  @SelfService()
  mySummary(@Tenant() tenant: TenantContext) {
    return this.loyalty.mySummary(tenant);
  }

  @Get('me/ledger')
  @SelfService()
  myLedger(@Tenant() tenant: TenantContext, @ZodQuery(LoyaltyLedgerQuerySchema) query: LoyaltyLedgerQuery) {
    return this.loyalty.myLedger(tenant, query);
  }

  @Post('me/redeem')
  @SelfService()
  redeemSelf(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(LoyaltyRedeemSchema) body: LoyaltyRedeemInput) {
    return this.loyalty.redeemSelf(tenant, user.id, body);
  }
}
