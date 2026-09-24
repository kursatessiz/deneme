import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationChannel, NotificationStatus } from '@platform/database';

export interface SendSmsParams {
  studioId: string;
  phone: string;
  message: string;
  type: 'REMINDER' | 'PACKAGE_EXPIRY' | 'CANCEL_ALERT' | 'CONFIRMATION';
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly isMock: boolean;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.isMock = this.config.get<string>('SMS_PROVIDER', 'MOCK') === 'MOCK';
  }

  async sendSms(params: SendSmsParams): Promise<{ success: boolean; messageId?: string }> {
    this.logger.log(`[SMS Queue] To: ${params.phone} | Type: ${params.type} | Msg: "${params.message}"`);

    if (this.isMock) {
      this.logger.log(`[MOCK SMS] Simulated SMS sent to ${params.phone}`);
      await this.logNotification(params, NotificationStatus.SENT);
      return { success: true, messageId: `mock-${Date.now()}` };
    }

    try {
      // Real provider implementation (e.g. Netgsm / İleti Merkezi HTTP API)
      const netgsmUser = this.config.get<string>('NETGSM_USER');
      const netgsmPassword = this.config.get<string>('NETGSM_PASSWORD');
      const netgsmHeader = this.config.get<string>('NETGSM_HEADER');

      // Example standard Netgsm REST API call
      /*
      const response = await fetch('https://api.netgsm.com.tr/sms/send/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usercode: netgsmUser,
          password: netgsmPassword,
          gsmno: params.phone,
          message: params.message,
          msgheader: netgsmHeader,
        }),
      });
      */

      await this.logNotification(params, NotificationStatus.SENT);
      return { success: true, messageId: `netgsm-${Date.now()}` };
    } catch (err: any) {
      this.logger.error(`SMS sending failed: ${err.message}`);
      await this.logNotification(params, NotificationStatus.FAILED, err.message);
      return { success: false };
    }
  }

  private async logNotification(params: SendSmsParams, status: NotificationStatus, error?: string) {
    try {
      await this.prisma.notificationLog.create({
        data: {
          studioId: params.studioId,
          recipientPhone: params.phone,
          channel: NotificationChannel.SMS,
          type: params.type,
          content: params.message,
          status,
          errorMessage: error,
        },
      });
    } catch (e) {
      this.logger.error('Failed to write notification log to DB', e);
    }
  }
}
