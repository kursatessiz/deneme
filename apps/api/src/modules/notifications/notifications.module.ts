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
import { NotificationSettingsService } from './settings/notification-settings.service';
import {
  NotificationSettingsController,
  SmsWalletAdminController,
  SmsWalletController,
} from './settings/notification-settings.controller';

@Global()
@Module({
  controllers: [ConsentController, NotificationSettingsController, SmsWalletController, SmsWalletAdminController],
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
    NotificationSettingsService,
  ],
  exports: [
    NotificationsService,
    PushService,
    NotificationPreferencesService,
    TemplateService,
    ConsentService,
    NotificationSettingsService,
  ],
})
export class NotificationsModule {}
