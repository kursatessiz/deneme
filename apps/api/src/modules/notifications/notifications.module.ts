import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { NotificationPreferencesService } from './notification-preferences.service';

@Global()
@Module({
  providers: [NotificationsService, PushService, NotificationPreferencesService],
  exports: [NotificationsService, PushService, NotificationPreferencesService],
})
export class NotificationsModule {}
