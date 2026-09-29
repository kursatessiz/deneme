import { Module } from '@nestjs/common';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { AdsModule } from '../ads/ads.module';
import { SocialConnectionsService } from './social-connections.service';
import { SocialPublisherRegistry } from './social-publisher.registry';
import { SocialPublishingService } from './social-publishing.service';

/**
 * Organic social publishing (M4b): connections, the per-network publishers
 * and the publishing service the scheduler heartbeat calls. The platform
 * endpoints, the brand check and the approval flow live in
 * PlatformMarketingModule, which imports this module; JobsModule imports it
 * for the heartbeat step. Outbound calls go through the allow-listed
 * AdsHttpClient of AdsModule.
 */
@Module({
  imports: [AdsModule],
  providers: [CredentialCipher, SocialPublisherRegistry, SocialConnectionsService, SocialPublishingService],
  exports: [SocialConnectionsService, SocialPublishingService, SocialPublisherRegistry],
})
export class SocialModule {}
