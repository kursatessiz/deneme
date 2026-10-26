import { Module } from '@nestjs/common';
import { EventSeatsService } from './event-seats.service';
import { UsagePeriodsCoreModule } from '../usage-periods/usage-periods-core.module';

/**
 * Event seat accounting and notices without controllers or module
 * dependencies beyond the global Prisma and messaging modules, so the
 * payments module can confirm a registration from the provider webhook
 * without an import cycle through EventsModule (same pattern as
 * LoyaltyCoreModule and CrmCoreModule).
 */
@Module({
  imports: [UsagePeriodsCoreModule],
  providers: [EventSeatsService],
  exports: [EventSeatsService],
})
export class EventsCoreModule {}
