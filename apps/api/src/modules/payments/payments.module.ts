import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { EventsCoreModule } from '../events/events-core.module';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { DunningController } from './dunning.controller';
import { PaymentsService } from './payments.service';
import { DunningService } from './dunning.service';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { IyzicoPaymentProvider } from './providers/iyzico-payment.provider';
import { PaytrPaymentProvider } from './providers/paytr-payment.provider';
import { StripePaymentProvider } from './providers/stripe-payment.provider';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { PaymentWebhookRouter } from './payment-webhook-router';

@Module({
  imports: [AuthModule, InvoicingModule, PromotionsModule, WebhooksModule, CrmCoreModule, EventsCoreModule],
  controllers: [PaymentsController, PaymentsWebhookController, DunningController],
  providers: [
    PaymentsService,
    DunningService,
    MockPaymentProvider,
    IyzicoPaymentProvider,
    PaytrPaymentProvider,
    StripePaymentProvider,
    PaymentProviderRegistry,
    PaymentWebhookRouter,
  ],
  exports: [PaymentsService, DunningService, PaymentProviderRegistry, PaymentWebhookRouter],
})
export class PaymentsModule {}
