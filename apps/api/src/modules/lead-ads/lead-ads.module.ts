import { Module } from '@nestjs/common';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { AdsHttpClient } from '../ads/ads-http-client';
import { AuthModule } from '../auth/auth.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { LeadAdsAdminController } from './lead-ads-admin.controller';
import { LeadAdsAdminService } from './lead-ads-admin.service';
import { LeadAdsWebhookController } from './lead-ads-webhook.controller';
import { LeadAdsService } from './lead-ads.service';
import { HttpMetaGraphClient, META_GRAPH_CLIENT } from './meta-graph.client';

/**
 * Meta Lead Ads intake (M4c, docs/PAZARLAMA_MODULU.md 5.2): the public
 * leadgen webhook, the intake service with its retry on the scheduler
 * heartbeat, and the admin service the integrations hub uses. The Graph
 * client is swappable (META_GRAPH_CLIENT); the real one reaches
 * graph.facebook.com only, through the allow-listed AdsHttpClient.
 */
@Module({
  imports: [AuthModule, CrmCoreModule, WebhooksModule],
  controllers: [LeadAdsWebhookController, LeadAdsAdminController],
  providers: [
    AdsHttpClient,
    CredentialCipher,
    { provide: META_GRAPH_CLIENT, useClass: HttpMetaGraphClient },
    LeadAdsService,
    LeadAdsAdminService,
  ],
  exports: [LeadAdsService, LeadAdsAdminService],
})
export class LeadAdsModule {}
