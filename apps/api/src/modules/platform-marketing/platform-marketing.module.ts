import { Module } from '@nestjs/common';
import { resolveCname, resolveMx, resolveTxt } from 'dns/promises';
import { AuthModule } from '../auth/auth.module';
import { AdsModule } from '../ads/ads.module';
import { AiModule } from '../ai/ai.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { FunnelsModule } from '../funnels/funnels.module';
import { GrowthModule } from '../growth/growth.module';
import { SocialModule } from '../social/social.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { LeadAdsModule } from '../lead-ads/lead-ads.module';
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
import { AdminMarketingSettingsController, MarketingApprovalsController, PlatformCampaignsController } from './approvals/marketing-approvals.controllers';
import { SocialPostsController } from './social/social-posts.controller';
import { SocialPostsService } from './social/social-posts.service';
import { PlatformMarketingContactsController } from './consent/marketing-consent.controller';
import { AdminMarketingInsightsController, MarketingInsightsController } from './insights/marketing-insights.controllers';
import { MarketingInsightsService } from './insights/marketing-insights.service';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { AdminOAuthClientsController, OAuthCallbackController, OAuthConnectController } from './oauth/oauth-connect.controller';
import { OAuthClientSettingsService } from './oauth/oauth-client-settings.service';
import { OAuthConnectService } from './oauth/oauth-connect.service';
import { OAuthProviderClient } from './oauth/oauth-provider.client';
import { OAuthCallbackRateLimitGuard, OAuthStartRateLimitGuard } from './oauth/oauth-rate-limit.guard';
import { OAuthRefreshService } from './oauth/oauth-refresh.service';

const systemDns: DnsLookup = { resolveTxt, resolveCname, resolveMx };

/** Platform marketing (docs/PAZARLAMA_MODULU.md): M1 the integrations hub, M2 the brand kit, AI studio and content calendar, M3a the KPI dashboard, M3b the approval queue, platform campaign actions and marketing settings (services in GrowthModule, next to the send path), M3e the double opt-in resend, M3d the weekly summary (heartbeat via JobsService) and the audit view (in AdminModule), M4b organic social posts (connections and publishing live in SocialModule), M4a OAuth connect (start, public callback, super admin client settings, token refresh on the heartbeat). */
@Module({
  imports: [AuthModule, AdsModule, AiModule, ApiKeysModule, CrmCoreModule, FunnelsModule, GrowthModule, SocialModule, WebhooksModule, LeadAdsModule],
  controllers: [
    PlatformIntegrationsController,
    BrandKitController,
    MarketingStudioController,
    ContentCalendarController,
    MarketingDashboardController,
    MarketingApprovalsController,
    PlatformCampaignsController,
    AdminMarketingSettingsController,
    PlatformMarketingContactsController,
    MarketingInsightsController,
    AdminMarketingInsightsController,
    SocialPostsController,
    OAuthConnectController,
    OAuthCallbackController,
    AdminOAuthClientsController,
  ],
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
    MarketingInsightsService,
    SocialPostsService,
    CredentialCipher,
    OAuthClientSettingsService,
    OAuthProviderClient,
    OAuthConnectService,
    OAuthRefreshService,
    OAuthStartRateLimitGuard,
    OAuthCallbackRateLimitGuard,
  ],
  exports: [MarketingInsightsService, OAuthRefreshService],
})
export class PlatformMarketingModule {}
