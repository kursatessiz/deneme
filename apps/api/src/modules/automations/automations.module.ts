import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GrowthModule } from '../growth/growth.module';
import { AutomationRulesController } from './automation-rules.controller';
import { AutomationRulesCompatService } from './automation-rules-compat.service';

/**
 * @deprecated W10 automations, reduced to the /automation-rules
 * compatibility wrapper over journeys (G2a, docs/KAMPANYA_VE_AKISLAR.md).
 * The rule evaluators and the runner were rewritten as journey triggers
 * (growth/journeys); this module goes away in the contract release.
 */
@Module({
  imports: [AuthModule, GrowthModule],
  controllers: [AutomationRulesController],
  providers: [AutomationRulesCompatService],
})
export class AutomationsModule {}
