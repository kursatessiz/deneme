import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { ConsentService } from './consent/consent.service';
import { ConsentController } from './consent/consent.controller';
import { IysClientAdapter } from './consent/iys-client.adapter';
import { NotificationSettingsService } from './settings/notification-settings.service';
import { SmsProviderBalanceService } from './sms-provider-balance.service';
import {
  NotificationSettingsController,
  SmsWalletAdminController,
  SmsWalletController,
} from './settings/notification-settings.controller';

/**
 * Notification preferences, push devices, İYS consent, channel order and
 * the SMS wallet. Sending itself lives in MessagingModule (G1c);
 * NotificationsService is kept as the compatibility facade over it.
 */
@Global()
@Module({
  controllers: [ConsentController, NotificationSettingsController, SmsWalletController, SmsWalletAdminController],
  providers: [
    NotificationsService,
    PushService,
    NotificationPreferencesService,
    ConsentService,
    IysClientAdapter,
    NotificationSettingsService,
    SmsProviderBalanceService,
  ],
  exports: [
    NotificationsService,
    PushService,
    NotificationPreferencesService,
    ConsentService,
    IysClientAdapter,
    NotificationSettingsService,
    SmsProviderBalanceService,
  ],
})
export class NotificationsModule {}
