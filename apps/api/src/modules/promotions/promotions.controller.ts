import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { GiftCardRateLimitGuard } from './gift-card-rate-limit.guard';
import { StudioScoped, RequirePermission, SelfService } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import {
  AdjustGiftCardSchema,
  AdjustGiftCardInput,
  CheckGiftCardBalanceSchema,
  CheckGiftCardBalanceInput,
  CreatePromoCodeSchema,
  CreatePromoCodeInput,
  IssueGiftCardSchema,
  IssueGiftCardInput,
  UpdatePromoCodeSchema,
  UpdatePromoCodeInput,
  ValidatePromoCodeSchema,
  ValidatePromoCodeInput,
} from '@platform/shared';

@Controller('promotions')
@StudioScoped()
export class PromotionsController {
  constructor(private promotions: PromotionsService) {}

  // ---------------------------------------------------------------------------
  // Promo codes
  // ---------------------------------------------------------------------------

  @Post('promo-codes')
  @RequirePermission('promotions.manage')
  async createPromoCode(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreatePromoCodeSchema) body: CreatePromoCodeInput) {
    return this.promotions.createPromoCode(tenant, user.id, body);
  }

  @Get('promo-codes')
  @RequirePermission('promotions.manage')
  async listPromoCodes(@Tenant() tenant: TenantContext) {
    return this.promotions.listPromoCodes(tenant);
  }

  @Get('promo-codes/:id')
  @RequirePermission('promotions.manage')
  async getPromoCode(@Param('id') id: string, @Tenant() tenant: TenantContext) {
    return this.promotions.getPromoCode(tenant, id);
  }

  @Put('promo-codes/:id')
  @RequirePermission('promotions.manage')
  async updatePromoCode(@Param('id') id: string, @Tenant() tenant: TenantContext, @ZodBody(UpdatePromoCodeSchema) body: UpdatePromoCodeInput) {
    return this.promotions.updatePromoCode(tenant, id, body);
  }

  @Get('promo-codes/:id/redemptions')
  @RequirePermission('promotions.manage')
  async listRedemptions(@Param('id') id: string, @Tenant() tenant: TenantContext) {
    return this.promotions.listPromoRedemptions(tenant, id);
  }

  /** Member self-service: preview the discount a code would give, without redeeming it. */
  @Get('promo-codes/validate/self')
  @SelfService()
  async validatePromoCodeSelf(@Tenant() tenant: TenantContext, @ZodQuery(ValidatePromoCodeSchema) query: ValidatePromoCodeInput) {
    return this.promotions.previewPromoCode(tenant, query.code, query.packageDefinitionId);
  }

  // ---------------------------------------------------------------------------
  // Gift cards
  // ---------------------------------------------------------------------------

  @Post('gift-cards')
  @RequirePermission('promotions.manage')
  async issueGiftCard(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(IssueGiftCardSchema) body: IssueGiftCardInput) {
    return this.promotions.issueGiftCard(tenant, user.id, body);
  }

  /** Member self-service: the gift cards this member purchased. Declared before :id so "mine" never matches as an id. */
  @Get('gift-cards/mine')
  @SelfService()
  async listMyGiftCards(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.promotions.listMyGiftCards(tenant, user.id);
  }

  @Get('gift-cards')
  @RequirePermission('promotions.manage')
  async listGiftCards(@Tenant() tenant: TenantContext) {
    return this.promotions.listGiftCards(tenant);
  }

  /** Member self-service: check a gift card's balance by code, rate-limited. Declared before :id so "check" never matches as an id. */
  @Get('gift-cards/check')
  @SelfService()
  @UseGuards(GiftCardRateLimitGuard)
  async checkGiftCardBalance(@Tenant() tenant: TenantContext, @ZodQuery(CheckGiftCardBalanceSchema) query: CheckGiftCardBalanceInput) {
    return this.promotions.checkGiftCardBalance(tenant, query.code);
  }

  @Get('gift-cards/:id')
  @RequirePermission('promotions.manage')
  async getGiftCard(@Param('id') id: string, @Tenant() tenant: TenantContext) {
    return this.promotions.getGiftCard(tenant, id);
  }

  @Get('gift-cards/:id/transactions')
  @RequirePermission('promotions.manage')
  async listGiftCardTransactions(@Param('id') id: string, @Tenant() tenant: TenantContext) {
    return this.promotions.listGiftCardTransactions(tenant, id);
  }

  @Post('gift-cards/:id/cancel')
  @RequirePermission('promotions.manage')
  async cancelGiftCard(@Param('id') id: string, @Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.promotions.cancelGiftCard(tenant, user.id, id);
  }

  @Post('gift-cards/:id/adjust')
  @RequirePermission('promotions.manage')
  async adjustGiftCard(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(AdjustGiftCardSchema) body: AdjustGiftCardInput,
  ) {
    return this.promotions.adjustGiftCard(tenant, user.id, id, body);
  }
}
