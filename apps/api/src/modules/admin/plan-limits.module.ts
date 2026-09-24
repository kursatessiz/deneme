import { Global, Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';

/**
 * Global like PrismaModule/RedisModule: PlanLimitsService is consumed by
 * several tenant-facing modules (members, branches, invites) that must not
 * import the whole AdminModule just to enforce a plan limit.
 */
@Global()
@Module({
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanLimitsModule {}
