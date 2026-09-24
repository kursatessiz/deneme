import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { DunningController } from './dunning.controller';
import { PaymentsService } from './payments.service';
import { DunningService } from './dunning.service';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { IyzicoPaymentProvider } from './providers/iyzico-payment.provider';
import { PaytrPaymentProvider } from './providers/paytr-payment.provider';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';

@Module({
  imports: [AuthModule, PromotionsModule],
  controllers: [PaymentsController, PaymentsWebhookController, DunningController],
  providers: [
    PaymentsService,
    DunningService,
    MockPaymentProvider,
    IyzicoPaymentProvider,
    PaytrPaymentProvider,
    PaymentProviderRegistry,
  ],
  exports: [PaymentsService, DunningService, PaymentProviderRegistry],
})
export class PaymentsModule {}
