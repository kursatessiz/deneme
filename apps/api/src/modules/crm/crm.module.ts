import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembersModule } from '../members/members.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { CrmCoreModule } from './crm-core.module';
import { CrmController } from './crm.controller';
import { FieldsService } from './fields/fields.service';
import { TasksService } from './tasks/tasks.service';
import { TrackingController } from './tracking/tracking.controller';
import { TrackingService } from './tracking/tracking.service';
import { TrackingRateLimitGuard } from './tracking/tracking-rate-limit.guard';
import { LeadsController } from './leads-compat/leads.controller';
import { LeadsPublicController } from './leads-compat/leads-public.controller';
import { LeadsCompatService } from './leads-compat/leads-compat.service';
import { LeadsPublicRateLimitGuard } from './leads-compat/leads-public-rate-limit.guard';

/** CRM and attribution (G1b), replacing the W11 leads module. See docs/CRM_VE_ATIF.md. */
@Module({
  imports: [AuthModule, CrmCoreModule, MembersModule, SchedulesModule],
  controllers: [CrmController, TrackingController, LeadsController, LeadsPublicController],
  providers: [
    FieldsService,
    TasksService,
    TrackingService,
    TrackingRateLimitGuard,
    LeadsCompatService,
    LeadsPublicRateLimitGuard,
  ],
})
export class CrmModule {}
