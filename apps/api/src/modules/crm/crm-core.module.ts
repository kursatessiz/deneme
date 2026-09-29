import { Module } from '@nestjs/common';
import { ContactsService } from './contacts/contacts.service';
import { PipelineService } from './pipeline/pipeline.service';
import { AttributionService } from './attribution/attribution.service';
import { ConversionService } from './conversions/conversion.service';
import { ConversionOutboxService } from './conversions/conversion-outbox.service';
import { AdConnectionResolver, PrismaAdConnectionResolver } from './conversions/ad-connection.resolver';
import { CrmHooksService } from './hooks/crm-hooks.service';
import { GrowthEventsService } from './hooks/growth-events.service';

/**
 * CRM services without controllers or module dependencies beyond the
 * global PrismaModule, so the business modules (members, invites,
 * schedules, payments, admin) can import it for CrmHooksService without an
 * import cycle through CrmModule.
 */
@Module({
  providers: [
    ContactsService,
    PipelineService,
    AttributionService,
    ConversionService,
    ConversionOutboxService,
    { provide: AdConnectionResolver, useClass: PrismaAdConnectionResolver },
    CrmHooksService,
    GrowthEventsService,
  ],
  exports: [
    ContactsService,
    PipelineService,
    AttributionService,
    ConversionService,
    ConversionOutboxService,
    CrmHooksService,
    GrowthEventsService,
  ],
})
export class CrmCoreModule {}
