import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { SegmentEvaluatorService } from './segments/segment-evaluator.service';
import { SegmentsService } from './segments/segments.service';
import { SegmentsController } from './segments/segments.controller';
import { CampaignsService } from './campaigns/campaigns.service';
import { CampaignsController } from './campaigns/campaigns.controller';
import { JourneyScannersService } from './journeys/journey-scanners.service';
import { JourneyEngineService } from './journeys/journey-engine.service';
import { JourneysService } from './journeys/journeys.service';
import { JourneysController } from './journeys/journeys.controller';
import { LegacyAutomationMigratorService } from './journeys/legacy-automation-migrator.service';
import { GROWTH_QUEUE, GrowthQueueService } from './growth-queue.service';
import { GrowthProcessor } from './growth.processor';
import { GrowthHeartbeatService } from './growth-heartbeat.service';

/** Same rule as JobsModule: BullMQ only when REDIS_URL is a real process env var (see jobs.module.ts). */
const redisConfigured = Boolean(process.env.REDIS_URL);

/**
 * Segments, campaigns and journeys (G2a, docs/KAMPANYA_VE_AKISLAR.md).
 * MessagingModule, NotificationsModule and ComplianceModule are global;
 * CrmCoreModule gives the CRM hooks and the growth event bus.
 */
@Module({
  imports: [AuthModule, CrmCoreModule, ...(redisConfigured ? [BullModule.registerQueue({ name: GROWTH_QUEUE })] : [])],
  controllers: [SegmentsController, CampaignsController, JourneysController],
  providers: [
    SegmentEvaluatorService,
    SegmentsService,
    CampaignsService,
    JourneyScannersService,
    JourneyEngineService,
    JourneysService,
    LegacyAutomationMigratorService,
    GrowthQueueService,
    GrowthHeartbeatService,
    ...(redisConfigured ? [GrowthProcessor] : []),
  ],
  exports: [
    SegmentEvaluatorService,
    SegmentsService,
    CampaignsService,
    JourneyScannersService,
    JourneyEngineService,
    JourneysService,
    LegacyAutomationMigratorService,
    GrowthHeartbeatService,
  ],
})
export class GrowthModule {}
