import { Module } from '@nestjs/common';
import { PlatformEventsService } from './platform-events.service';

/**
 * Platform events (M4c) as a standalone module with no imports beyond the
 * global PrismaModule, so CrmCoreModule, BillingModule and GrowthModule can
 * emit them without an import cycle through WebhooksModule (which needs
 * AuthModule).
 */
@Module({
  providers: [PlatformEventsService],
  exports: [PlatformEventsService],
})
export class PlatformEventsModule {}
