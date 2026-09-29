import { Module } from '@nestjs/common';
import { resolveCname, resolveMx, resolveTxt } from 'dns/promises';
import { AuthModule } from '../auth/auth.module';
import { AdsModule } from '../ads/ads.module';
import { AiModule } from '../ai/ai.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { FunnelsModule } from '../funnels/funnels.module';
import { GrowthModule } from '../growth/growth.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { MarketingDashboardController } from './dashboard/marketing-dashboard.controller';
import { MarketingDashboardService } from './dashboard/marketing-dashboard.service';
import { DNS_LOOKUP, IntegrationHubService } from './integrations/integration-hub.service';
import { PlatformIntegrationsController } from './integrations/platform-integrations.controller';
import type { DnsLookup } from './integrations/email-domain-dns';
import { BrandKitService } from './studio/brand-kit.service';
import { ContentCalendarService } from './studio/content-calendar.service';
import { MarketingAiRateLimitGuard } from './studio/marketing-ai-rate-limit.guard';
import { MarketingAiService } from './studio/marketing-ai.service';
import { MarketingDraftsService } from './studio/marketing-drafts.service';
import { BrandKitController, ContentCalendarController, MarketingStudioController } from './studio/marketing-studio.controllers';
import { SegmentInsightService } from './studio/segment-insight.service';

const systemDns: DnsLookup = { resolveTxt, resolveCname, resolveMx };

/** Platform marketing (docs/PAZARLAMA_MODULU.md): M1 the integrations hub, M2 the brand kit, AI studio and content calendar, M3a the KPI dashboard; later phases add approvals here. */
@Module({
  imports: [AuthModule, AdsModule, AiModule, ApiKeysModule, CrmCoreModule, FunnelsModule, GrowthModule, WebhooksModule],
  controllers: [PlatformIntegrationsController, BrandKitController, MarketingStudioController, ContentCalendarController, MarketingDashboardController],
  providers: [
    IntegrationHubService,
    { provide: DNS_LOOKUP, useValue: systemDns },
    BrandKitService,
    SegmentInsightService,
    MarketingDraftsService,
    MarketingAiService,
    ContentCalendarService,
    MarketingAiRateLimitGuard,
    MarketingDashboardService,
  ],
})
export class PlatformMarketingModule {}
