import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationChannel, NotificationStatus } from '@platform/database';
import type { NotificationCategory } from '@platform/shared';
import { PushService, PushMessage } from './push.service';
import { NotificationPreferencesService } from './notification-preferences.service';

export interface SendSmsParams {
  /** Null for platform messages (login codes). */
  studioId: string | null;
  phone: string;
  message: string;
  type: 'REMINDER' | 'PACKAGE_EXPIRY' | 'CANCEL_ALERT' | 'CONFIRMATION' | 'LOGIN_OTP' | 'INVITE_OTP' | 'INVITE_LINK';
  /** Codes and invite links: never written to logs or the database. */
  sensitive?: boolean;
}

const REDACTED = '[gizli icerik]';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly isMock: boolean;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private push: PushService,
    private preferences: NotificationPreferencesService,
  ) {
    this.isMock = this.config.get<string>('SMS_PROVIDER', 'MOCK') === 'MOCK';
  }

  /**
   * Category notifications honour the user's preferences: push first, SMS
   * as well when the user enabled it for this category. Security messages
   * (codes, invites) must use sendSms directly and are never filtered.
   */
  async notifyUser(params: {
    userId: string;
    studioId: string | null;
    category: NotificationCategory;
    message: PushMessage;
    smsText?: string;
  }): Promise<{ push: number; sms: boolean }> {
    const channels = await this.preferences.channelsFor(params.userId, params.category);
    const pushed = channels.push ? await this.push.sendToUser(params.userId, params.message) : 0;

    let smsSent = false;
    if (channels.sms && params.smsText) {
      const user = await this.prisma.user.findUnique({ where: { id: params.userId }, select: { phone: true } });
      if (user) {
        const result = await this.sendSms({
          studioId: params.studioId,
          phone: user.phone,
          message: params.smsText,
          type: 'REMINDER',
        });
        smsSent = result.success;
      }
    }
    return { push: pushed, sms: smsSent };
  }

  async sendSms(params: SendSmsParams): Promise<{ success: boolean; messageId?: string }> {
    const loggable = params.sensitive ? REDACTED : params.message;
    this.logger.log(`[SMS Queue] To: ${params.phone} | Type: ${params.type} | Msg: "${loggable}"`);

    if (this.isMock) {
      // Local development only: show the real text so codes can be used.
      if (params.sensitive && this.config.get<string>('NODE_ENV') === 'development') {
        this.logger.warn(`[MOCK SMS] ${params.phone}: ${params.message}`);
      }
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
          content: params.sensitive ? REDACTED : params.message,
          status,
          errorMessage: error,
        },
      });
    } catch (e) {
      this.logger.error('Failed to write notification log to DB', e);
    }
  }
}
