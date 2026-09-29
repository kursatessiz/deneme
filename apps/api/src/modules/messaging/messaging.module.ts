import { Global, Module } from '@nestjs/common';
import { CrmCoreModule } from '../crm/crm-core.module';
import { SmsNetgsmAdapter } from './channels/sms-netgsm.adapter';
import { SmsIletiMerkeziAdapter } from './channels/sms-iletimerkezi.adapter';
import { SmsTwilioAdapter } from './channels/sms-twilio.adapter';
import { WhatsAppCloudAdapter } from './channels/whatsapp-cloud.adapter';
import { SesEmailAdapter } from './channels/email-ses.adapter';
import { MessagingChannelRegistry } from './channels/channel-registry.service';
import { MessagingService } from './engine/messaging.service';
import { TemplateResolver } from './engine/template-resolver.service';
import { OptOutService } from './engine/opt-out.service';
import { MessagingUrls } from './tracking/messaging-urls.service';
import { TrackingService } from './tracking/tracking.service';
import { MessageTrackingController } from './tracking/tracking.controller';
import { DeliveryStatusService } from './webhooks/delivery-status.service';
import { TwilioWebhookController } from './webhooks/twilio-webhook.controller';
import { WhatsAppWebhookController } from './webhooks/whatsapp-webhook.controller';
import { SesWebhookController } from './webhooks/ses-webhook.controller';
import { SmsDlrController } from './webhooks/sms-dlr.controller';
import { SNS_CERT_FETCHER, fetchSnsCertificate } from './webhooks/sns-verifier';
import { InboundService } from './inbox/inbound.service';
import { InboxService } from './inbox/inbox.service';
import { InboxController, MemberMessagingController } from './inbox/inbox.controller';
import { MessageTemplatesService } from './settings/message-templates.service';
import { MessagingRoutingAdminController, MessagingSettingsController } from './settings/messaging-settings.controller';

/**
 * G1c messaging engine (docs/MESAJLASMA.md): channels on the provider
 * registry, the single MessagingService.send(), templates, tracking,
 * provider webhooks, inbound messages and the inbox. Global so every
 * business module (and NotificationsService, the compatibility facade)
 * can inject MessagingService without an import cycle; NotificationsModule
 * and ComplianceModule are global too.
 */
@Global()
@Module({
  imports: [CrmCoreModule],
  controllers: [
    MessageTrackingController,
    InboxController,
    MemberMessagingController,
    MessagingSettingsController,
    MessagingRoutingAdminController,
    TwilioWebhookController,
    WhatsAppWebhookController,
    SesWebhookController,
    SmsDlrController,
  ],
  providers: [
    SmsNetgsmAdapter,
    SmsIletiMerkeziAdapter,
    SmsTwilioAdapter,
    WhatsAppCloudAdapter,
    SesEmailAdapter,
    MessagingChannelRegistry,
    TemplateResolver,
    OptOutService,
    MessagingUrls,
    MessagingService,
    DeliveryStatusService,
    TrackingService,
    InboundService,
    InboxService,
    MessageTemplatesService,
    { provide: SNS_CERT_FETCHER, useValue: fetchSnsCertificate },
  ],
  exports: [MessagingService, MessagingChannelRegistry, OptOutService, InboundService, DeliveryStatusService, MessagingUrls, MessageTemplatesService],
})
export class MessagingModule {}
