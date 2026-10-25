import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsagePeriodsController } from './usage-periods.controller';
import { UsagePeriodsCoreModule } from './usage-periods-core.module';

/** The studio switch endpoints of the usage periods feature (docs/KULLANIM_DONEMLERI.md). */
@Module({
  imports: [AuthModule, UsagePeriodsCoreModule],
  controllers: [UsagePeriodsController],
})
export class UsagePeriodsModule {}
