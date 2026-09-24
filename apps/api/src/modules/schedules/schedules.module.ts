import { Module } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { AuthModule } from '../auth/auth.module';
import { GamificationModule } from '../gamification/gamification.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { VideoMeetingService } from '../video/providers/video-meeting.service';
import { ManualMeetingAdapter } from '../video/providers/manual-meeting.adapter';
import { JitsiMeetingAdapter } from '../video/providers/jitsi-meeting.adapter';

@Module({
  imports: [AuthModule, GamificationModule, WebhooksModule],
  controllers: [SchedulesController],
  providers: [SchedulesService, VideoMeetingService, ManualMeetingAdapter, JitsiMeetingAdapter],
  exports: [SchedulesService],
})
export class SchedulesModule {}
