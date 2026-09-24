import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { JoinReminderService } from './join-reminder.service';

@Module({
  imports: [AuthModule],
  controllers: [ContentController],
  providers: [ContentService, JoinReminderService],
  exports: [ContentService, JoinReminderService],
})
export class VideoModule {}
