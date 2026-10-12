import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { ErasureAnonymizerService } from './erasure-anonymizer.service';
import { ErasureJobsService } from './erasure-jobs.service';
import { ErasureRequestsService } from './erasure-requests.service';
import { ErasureSelfController, ErasureStaffController } from './erasure.controller';

/**
 * KVKK/GDPR personal data erasure of one studio membership
 * (docs/KVKK_SILME.md): member request, staff decision, the anonymizer and
 * the heartbeat step. MessagingModule is global.
 */
@Module({
  imports: [AuthModule, NotificationsModule, SchedulesModule],
  controllers: [ErasureStaffController, ErasureSelfController],
  providers: [ErasureAnonymizerService, ErasureRequestsService, ErasureJobsService],
  exports: [ErasureJobsService],
})
export class ErasureModule {}
