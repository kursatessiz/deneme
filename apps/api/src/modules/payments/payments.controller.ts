import { Controller, Get, Param, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { StudioScoped, RequirePermission, SelfService } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import {
  CancelSubscriptionSchema,
  CancelSubscriptionInput,
  CardTokenSchema,
  CardTokenInput,
  ConfirmBankTransferSchema,
  ConfirmBankTransferInput,
  CreateSubscriptionSchema,
  CreateSubscriptionInput,
  ListPaymentsQuerySchema,
  ListPaymentsQuery,
  MemberCheckoutSchema,
  MemberCheckoutInput,
  PauseSubscriptionSchema,
  PauseSubscriptionInput,
  RefundPaymentSchema,
  RefundPaymentInput,
  SellPackageSchema,
  SellPackageInput,
} from '@platform/shared';

@Controller('payments')
@StudioScoped()
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post('sell')
  @RequirePermission('packages.sell')
  async sell(@Tenant() tenant: TenantContext, @ZodBody(SellPackageSchema) body: SellPackageInput) {
    return this.payments.sellPackage(tenant, body);
  }

  @Post('checkout/self')
  @SelfService()
  async checkoutSelf(@Tenant() tenant: TenantContext, @ZodBody(MemberCheckoutSchema) body: MemberCheckoutInput) {
    return this.payments.memberCheckout(tenant, body);
  }

  @Post('bank-transfer/confirm')
  @RequirePermission('finance.manage')
  async confirmBankTransfer(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(ConfirmBankTransferSchema) body: ConfirmBankTransferInput,
  ) {
    return this.payments.confirmBankTransfer(tenant, user.id, body);
  }

  @Get()
  @RequirePermission('finance.view')
  async list(@Tenant() tenant: TenantContext, @ZodQuery(ListPaymentsQuerySchema) query: ListPaymentsQuery) {
    return this.payments.listPayments(tenant, query);
  }

  @Get('self')
  @SelfService()
  async listSelf(@Tenant() tenant: TenantContext) {
    return this.payments.listMyPayments(tenant);
  }

  @Post(':paymentId/refund')
  @RequirePermission('finance.manage')
  async refund(
    @Param('paymentId') paymentId: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(RefundPaymentSchema) body: RefundPaymentInput,
  ) {
    return this.payments.refundPayment(tenant, user.id, paymentId, body);
  }

  // ---------------------------------------------------------------------------
  // Stored cards
  // ---------------------------------------------------------------------------

  @Post('cards/self')
  @SelfService()
  async addCardSelf(@Tenant() tenant: TenantContext, @ZodBody(CardTokenSchema) body: CardTokenInput) {
    return this.payments.addStoredCardSelf(tenant, body);
  }

  @Get('cards/self')
  @SelfService()
  async listCardsSelf(@Tenant() tenant: TenantContext) {
    return this.payments.listMyStoredCards(tenant);
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  @Post('subscriptions')
  @RequirePermission('packages.sell')
  async createSubscription(@Tenant() tenant: TenantContext, @ZodBody(CreateSubscriptionSchema) body: CreateSubscriptionInput) {
    return this.payments.createSubscription(tenant, body);
  }

  @Get('subscriptions/self')
  @SelfService()
  async listSubscriptionsSelf(@Tenant() tenant: TenantContext) {
    return this.payments.listMySubscriptions(tenant);
  }

  @Post('subscriptions/:id/cancel')
  @RequirePermission('packages.sell')
  async cancelSubscription(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(CancelSubscriptionSchema) body: CancelSubscriptionInput,
  ) {
    return this.payments.cancelSubscription(tenant, id, body);
  }

  @Post('subscriptions/:id/cancel/self')
  @SelfService()
  async cancelSubscriptionSelf(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(CancelSubscriptionSchema) body: CancelSubscriptionInput,
  ) {
    return this.payments.cancelSubscriptionSelf(tenant, id, body);
  }

  @Post('subscriptions/:id/pause')
  @RequirePermission('packages.sell')
  async pauseSubscription(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(PauseSubscriptionSchema) body: PauseSubscriptionInput,
  ) {
    return this.payments.pauseSubscription(tenant, id, body);
  }

  @Post('subscriptions/:id/resume')
  @RequirePermission('packages.sell')
  async resumeSubscription(@Param('id') id: string, @Tenant() tenant: TenantContext) {
    return this.payments.resumeSubscription(tenant, id);
  }
}
