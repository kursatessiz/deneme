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
import { AdminAddOnsController } from './add-ons/admin-add-ons.controller';
import { AdminAddOnsService } from './add-ons/admin-add-ons.service';
import { StudioAddOnsController } from './add-ons/studio-add-ons.controller';
import { StudioAddOnsService } from './add-ons/studio-add-ons.service';
import { AddOnChargeService } from './add-ons/add-on-charge.service';
import { AddOnJobsService } from './add-ons/add-ons-jobs.service';

/**
 * Platform billing of tenants (G5c-1, docs/DENEME_VE_ETKINLESTIRME.md):
 * trial, activation, restricted mode heartbeat and business-to-business
 * referrals. Restricted mode itself is enforced by BillingWriteGuard in
 * the auth module (part of @StudioScoped()). G5c-2 adds the add-on
 * marketplace (docs/UYGULAMA_PAZARI.md) here: catalogue, trials, add-on
 * charges and the add-on part of the billing heartbeat.
 */
@Module({
  imports: [AuthModule, PaymentsModule, CrmCoreModule, MessagingModule, PlatformEventsModule],
  controllers: [BillingController, AdminBillingController, AdminAddOnsController, StudioAddOnsController],
  providers: [PlatformBillingService, StudioReferralsService, BillingJobsService, AdminAddOnsService, StudioAddOnsService, AddOnChargeService, AddOnJobsService],
  exports: [PlatformBillingService, StudioReferralsService, BillingJobsService],
})
export class BillingModule {}
