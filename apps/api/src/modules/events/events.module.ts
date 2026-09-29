import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { LoyaltyCoreModule } from '../loyalty/loyalty-core.module';
import { EventsCoreModule } from './events-core.module';
import { EventsController, EventsSelfController } from './events.controller';
import { EventsPublicController, EventsPublicRateLimitGuard } from './events-public.controller';
import { EventsService } from './events.service';
import { EventRegistrationsService } from './event-registrations.service';
import { EventsJobsService } from './events-jobs.service';

/**
 * Events, workshops and multi-session courses (G3c-1, docs/ETKINLIKLER.md).
 * The self-service controller is listed first so its `self` routes win
 * over the staff `:eventId` routes. MessagingModule and RedisModule are
 * global.
 */
@Module({
  imports: [AuthModule, PaymentsModule, CrmCoreModule, LoyaltyCoreModule, EventsCoreModule, WebhooksModule],
  controllers: [EventsSelfController, EventsController, EventsPublicController],
  providers: [EventsService, EventRegistrationsService, EventsJobsService, EventsPublicRateLimitGuard],
  exports: [EventsJobsService],
})
export class EventsModule {}
