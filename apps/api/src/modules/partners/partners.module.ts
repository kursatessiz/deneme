import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PartnersController } from './partners.controller';
import { PartnersWebhookController } from './partners-webhook.controller';
import { PartnerReportsController } from './partner-reports.controller';
import { PartnerConnectionsService } from './partner-connections.service';
import { PartnerReservationsService } from './partner-reservations.service';
import { PartnersWebhookService } from './partners-webhook.service';
import { PartnerSyncService } from './partner-sync.service';
import { PartnerReportsService } from './partner-reports.service';
import { MockPartnerProvider } from './providers/mock-partner.provider';
import { PartnerProviderRegistry } from './providers/partner-provider.registry';
import { CredentialCipher } from '../../common/crypto/credential-cipher';

@Module({
  imports: [AuthModule],
  controllers: [PartnersController, PartnersWebhookController, PartnerReportsController],
  providers: [
    PartnerConnectionsService,
    PartnerReservationsService,
    PartnersWebhookService,
    PartnerSyncService,
    PartnerReportsService,
    MockPartnerProvider,
    PartnerProviderRegistry,
    CredentialCipher,
  ],
  exports: [PartnerSyncService, PartnerConnectionsService],
})
export class PartnersModule {}
