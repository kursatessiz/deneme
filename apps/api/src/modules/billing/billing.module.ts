import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PlatformEventsModule } from '../webhooks/platform-events.module';
import { BillingController } from './billing.controller';
import { AdminBillingController } from './admin-billing.controller';
import { PlatformBillingService } from './platform-billing.service';
import { StudioReferralsService } from './studio-referrals.service';
import { BillingJobsService } from './billing-jobs.service';

/**
 * Platform billing of tenants (G5c-1, docs/DENEME_VE_ETKINLESTIRME.md):
 * trial, activation, restricted mode heartbeat and business-to-business
 * referrals. Restricted mode itself is enforced by BillingWriteGuard in
 * the auth module (part of @StudioScoped()).
 */
@Module({
  imports: [AuthModule, PaymentsModule, CrmCoreModule, MessagingModule, PlatformEventsModule],
  controllers: [BillingController, AdminBillingController],
  providers: [PlatformBillingService, StudioReferralsService, BillingJobsService],
  exports: [PlatformBillingService, StudioReferralsService, BillingJobsService],
})
export class BillingModule {}
