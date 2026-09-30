import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { AdsModule } from '../ads/ads.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { LoyaltyCoreModule } from '../loyalty/loyalty-core.module';
import { PlatformEventsModule } from '../webhooks/platform-events.module';
import { SegmentEvaluatorService } from './segments/segment-evaluator.service';
import { SegmentsService } from './segments/segments.service';
import { SegmentsController } from './segments/segments.controller';
import { CampaignsService } from './campaigns/campaigns.service';
import { CampaignsController } from './campaigns/campaigns.controller';
import { CampaignAbService } from './campaigns/campaign-ab.service';
import { CampaignSendTimeService } from './campaigns/campaign-send-time.service';
import { JourneyScannersService } from './journeys/journey-scanners.service';
import { JourneyEngineService } from './journeys/journey-engine.service';
import { JourneysService } from './journeys/journeys.service';
import { JourneysController } from './journeys/journeys.controller';
import { LegacyAutomationMigratorService } from './journeys/legacy-automation-migrator.service';
import { GROWTH_QUEUE, GrowthQueueService } from './growth-queue.service';
import { GrowthProcessor } from './growth.processor';
import { GrowthHeartbeatService } from './growth-heartbeat.service';
import { CampaignApprovalService } from './campaigns/approval/campaign-approval.service';
import { CampaignPrecheckService } from './campaigns/approval/campaign-precheck.service';
import { MarketingSettingsService } from './campaigns/approval/marketing-settings.service';
import { MarketingNoticeService } from './campaigns/approval/marketing-notice.service';
import { MarketingGuardsService } from './campaigns/marketing-guards.service';
import { AdCapAutoPauseService } from './campaigns/ad-cap-auto-pause.service';

/** Same rule as JobsModule: BullMQ only when REDIS_URL is a real process env var (see jobs.module.ts). */
const redisConfigured = Boolean(process.env.REDIS_URL);

/**
 * Segments, campaigns and journeys (G2a, docs/KAMPANYA_VE_AKISLAR.md).
 * MessagingModule, NotificationsModule and ComplianceModule are global;
 * CrmCoreModule gives the CRM hooks and the growth event bus;
 * LoyaltyCoreModule the ledger for the award_points step (G3a).
 */
@Module({
  imports: [AuthModule, AdsModule, CrmCoreModule, LoyaltyCoreModule, PlatformEventsModule, ...(redisConfigured ? [BullModule.registerQueue({ name: GROWTH_QUEUE })] : [])],
  controllers: [SegmentsController, CampaignsController, JourneysController],
  providers: [
    SegmentEvaluatorService,
    SegmentsService,
    CampaignsService,
    CampaignAbService,
    CampaignSendTimeService,
    CampaignPrecheckService,
    CampaignApprovalService,
    MarketingSettingsService,
    MarketingNoticeService,
    MarketingGuardsService,
    AdCapAutoPauseService,
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
    CampaignApprovalService,
    MarketingSettingsService,
    MarketingNoticeService,
    MarketingGuardsService,
    JourneyScannersService,
    JourneyEngineService,
    JourneysService,
    LegacyAutomationMigratorService,
    GrowthHeartbeatService,
  ],
})
export class GrowthModule {}
