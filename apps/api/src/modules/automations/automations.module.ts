import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutomationRulesController } from './automation-rules.controller';
import { AutomationRulesService } from './automation-rules.service';
import { AutomationRunnerService } from './automation-runner.service';
import { WinBackEvaluator } from './evaluators/win-back.evaluator';
import { PackageExpiringEvaluator } from './evaluators/package-expiring.evaluator';
import { BirthdayEvaluator } from './evaluators/birthday.evaluator';
import { FirstClassFollowUpEvaluator } from './evaluators/first-class-follow-up.evaluator';
import { BookingReminderEvaluator } from './evaluators/booking-reminder.evaluator';
import { NoShowFollowUpEvaluator } from './evaluators/no-show-follow-up.evaluator';

@Module({
  imports: [AuthModule],
  controllers: [AutomationRulesController],
  providers: [
    AutomationRulesService,
    AutomationRunnerService,
    WinBackEvaluator,
    PackageExpiringEvaluator,
    BirthdayEvaluator,
    FirstClassFollowUpEvaluator,
    BookingReminderEvaluator,
    NoShowFollowUpEvaluator,
  ],
  exports: [AutomationRunnerService, AutomationRulesService],
})
export class AutomationsModule {}
