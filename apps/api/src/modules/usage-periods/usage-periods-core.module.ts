import { Module } from '@nestjs/common';
import { UsagePeriodsService } from './usage-periods.service';
import { UsagePeriodsJobsService } from './usage-periods-jobs.service';

/**
 * Usage periods services without controllers or module dependencies beyond the global Prisma and messaging
 * modules, so schedules, members, payments and events can import them without cycles (same pattern as
 * EventsCoreModule and CrmCoreModule).
 */
@Module({
  providers: [UsagePeriodsService, UsagePeriodsJobsService],
  exports: [UsagePeriodsService, UsagePeriodsJobsService],
})
export class UsagePeriodsCoreModule {}
