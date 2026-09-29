import { Module } from '@nestjs/common';
import { resolveCname, resolveMx, resolveTxt } from 'dns/promises';
import { AuthModule } from '../auth/auth.module';
import { AdsModule } from '../ads/ads.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { DNS_LOOKUP, IntegrationHubService } from './integrations/integration-hub.service';
import { PlatformIntegrationsController } from './integrations/platform-integrations.controller';
import type { DnsLookup } from './integrations/email-domain-dns';

const systemDns: DnsLookup = { resolveTxt, resolveCname, resolveMx };

/** Platform marketing (docs/PAZARLAMA_MODULU.md): M1 ships the integrations hub; later phases add AI, approvals and the dashboard here. */
@Module({
  imports: [AuthModule, AdsModule, ApiKeysModule, WebhooksModule],
  controllers: [PlatformIntegrationsController],
  providers: [IntegrationHubService, { provide: DNS_LOOKUP, useValue: systemDns }],
})
export class PlatformMarketingModule {}
