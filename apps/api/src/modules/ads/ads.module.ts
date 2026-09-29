import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { AdsHttpClient } from './ads-http-client';
import { AdsRateLimitGuard } from './ads-rate-limit.guard';
import { AdConnectionsService } from './connections/ad-connections.service';
import { AdConnectionsController } from './connections/ad-connections.controller';
import { AdConnectionTestService } from './connections/ad-connection-test.service';
import { ConversionDeliveryDispatcherService } from './delivery/conversion-delivery-dispatcher.service';
import { AdSpendSyncService } from './spend-sync/ad-spend-sync.service';
import { AdSpendSyncController } from './spend-sync/ad-spend-sync.controller';
import { PublicAdsConfigController } from './public-ads-config.controller';

/**
 * Ad platform integration (G2b): connections, conversion delivery and spend
 * sync. See docs/REKLAM_ENTEGRASYONU.md. The attribution report itself
 * stays in CrmModule (crm/attribution); this module only adds the spend
 * side that report joins against.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdConnectionsController, AdSpendSyncController, PublicAdsConfigController],
  providers: [
    AdsHttpClient,
    CredentialCipher,
    AdsRateLimitGuard,
    AdConnectionsService,
    AdConnectionTestService,
    ConversionDeliveryDispatcherService,
    AdSpendSyncService,
  ],
  exports: [ConversionDeliveryDispatcherService, AdSpendSyncService, AdConnectionsService, AdsHttpClient],
})
export class AdsModule {}
