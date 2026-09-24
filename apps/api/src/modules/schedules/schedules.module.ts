import { Module } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { AuthModule } from '../auth/auth.module';
import { GamificationModule } from '../gamification/gamification.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [AuthModule, GamificationModule, WebhooksModule],
  controllers: [SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
