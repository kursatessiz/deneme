import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadsPublicController } from './leads-public.controller';
import { LeadsPublicRateLimitGuard } from './leads-public-rate-limit.guard';
import { AuthModule } from '../auth/auth.module';
import { MembersModule } from '../members/members.module';
import { SchedulesModule } from '../schedules/schedules.module';

@Module({
  imports: [AuthModule, MembersModule, SchedulesModule],
  controllers: [LeadsController, LeadsPublicController],
  providers: [LeadsService, LeadsPublicRateLimitGuard],
})
export class LeadsModule {}
