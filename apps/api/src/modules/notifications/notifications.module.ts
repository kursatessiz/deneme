import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { TemplateService } from './templates/template.service';
import { ConsentService } from './consent/consent.service';
import { ConsentController } from './consent/consent.controller';
import { IysClientAdapter } from './consent/iys-client.adapter';
import { WhatsAppCloudAdapter } from './channels/whatsapp-cloud.adapter';
import { SmsNetgsmAdapter } from './channels/sms-netgsm.adapter';
import { SmsIletiMerkeziAdapter } from './channels/sms-iletimerkezi.adapter';
import { SmsTwilioAdapter } from './channels/sms-twilio.adapter';
import { TwilioWebhookController } from './channels/twilio-webhook.controller';
import { NotificationSettingsService } from './settings/notification-settings.service';
import { SmsProviderBalanceService } from './sms-provider-balance.service';
import {
  NotificationSettingsController,
  SmsWalletAdminController,
  SmsWalletController,
} from './settings/notification-settings.controller';

@Global()
@Module({
  controllers: [ConsentController, NotificationSettingsController, SmsWalletController, SmsWalletAdminController, TwilioWebhookController],
  providers: [
    NotificationsService,
    PushService,
    NotificationPreferencesService,
    TemplateService,
    ConsentService,
    IysClientAdapter,
    WhatsAppCloudAdapter,
    SmsNetgsmAdapter,
    SmsIletiMerkeziAdapter,
    SmsTwilioAdapter,
    NotificationSettingsService,
    SmsProviderBalanceService,
  ],
  exports: [
    NotificationsService,
    PushService,
    NotificationPreferencesService,
    TemplateService,
    ConsentService,
    NotificationSettingsService,
    SmsProviderBalanceService,
  ],
})
export class NotificationsModule {}
