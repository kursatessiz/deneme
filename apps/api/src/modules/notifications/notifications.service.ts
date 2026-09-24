import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationChannel, NotificationStatus } from '@platform/database';
import type { NotificationCategory, ConsentChannelName } from '@platform/shared';
import { parseNotificationSettings, effectiveChannelOrder } from '@platform/shared';
import { PushService, PushMessage } from './push.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { TemplateService } from './templates/template.service';
import { ConsentService } from './consent/consent.service';
import { WhatsAppCloudAdapter } from './channels/whatsapp-cloud.adapter';
import { SmsNetgsmAdapter } from './channels/sms-netgsm.adapter';
import { SmsIletiMerkeziAdapter } from './channels/sms-iletimerkezi.adapter';
import type { MessageChannel } from './channels/message-channel.interface';

export interface SendSmsParams {
  /** Null for platform messages (login codes). */
  studioId: string | null;
  phone: string;
  message: string;
  type: 'REMINDER' | 'PACKAGE_EXPIRY' | 'CANCEL_ALERT' | 'CONFIRMATION' | 'LOGIN_OTP' | 'INVITE_OTP' | 'INVITE_LINK';
  /** Codes and invite links: never written to logs or the database. */
  sensitive?: boolean;
}

/** The W7 entry point: template-driven, channel-order-aware, consent-gated. */
export interface SendParams {
  /** Null only for platform-wide messages; tenant sends always set this. */
  studioId: string | null;
  userId: string;
  category: NotificationCategory;
  /** Template key, e.g. BOOKING_REMINDER (see MESSAGE_TEMPLATE_KEYS). */
  template: string;
  params: Record<string, string>;
  /** Codes: content is never written to logs or the database. */
  sensitive?: boolean;
}

export interface SendResult {
  success: boolean;
  channel?: 'WHATSAPP' | 'SMS';
  providerMessageId?: string;
  /** Why no channel could deliver the message (or why it was skipped). */
  reason?: string;
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
    private templates: TemplateService,
    private consents: ConsentService,
    private whatsapp: WhatsAppCloudAdapter,
    private netgsm: SmsNetgsmAdapter,
    private iletiMerkezi: SmsIletiMerkeziAdapter,
  ) {
    this.isMock = this.config.get<string>('SMS_PROVIDER', 'MOCK') === 'MOCK';
  }

  // ---------------------------------------------------------------------
  // W7: unified, template-driven send with channel order/fallback/consent
  // ---------------------------------------------------------------------

  /**
   * Resolves the tenant's channel order and fallback, respects the user's
   * category preference, gates non-transactional templates on İYS consent,
   * tries WhatsApp then falls back to SMS, and deducts SmsWallet credits
   * only for an SMS that actually went out.
   */
  async send(input: SendParams): Promise<SendResult> {
    const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { phone: true } });
    if (!user) return { success: false, reason: 'Kullanıcı bulunamadı' };

    const channels = await this.preferences.channelsFor(input.userId, input.category);
    if (!channels.sms) {
      // The user turned this category's messaging off; nothing to log,
      // same as the existing notifyUser behaviour.
      return { success: false, reason: 'Kullanıcı bu kategori için kapatmış' };
    }

    const settings = input.studioId
      ? parseNotificationSettings(
          (await this.prisma.studio.findUnique({ where: { id: input.studioId }, select: { notificationSettings: true } }))
            ?.notificationSettings,
        )
      : parseNotificationSettings(undefined);
    const order = effectiveChannelOrder(settings);

    let fallbackOfId: string | undefined;
    let lastReason = 'Yapılandırılmış kanal yok';

    for (const channelName of order) {
      const channel: NotificationChannel = channelName === 'WHATSAPP' ? NotificationChannel.WHATSAPP : NotificationChannel.SMS;
      let resolved;
      try {
        resolved = await this.templates.resolve(input.studioId, input.template, channel);
      } catch {
        lastReason = `"${input.template}" için ${channelName} şablonu yok`;
        continue;
      }

      if (!resolved.isTransactional) {
        const granted = await this.consents.isGranted(input.studioId ?? '', input.userId, channelName as ConsentChannelName);
        if (!granted) {
          lastReason = `${channelName} için ticari mesaj onayı yok`;
          continue;
        }
      }

      const body = this.templates.render(resolved.body, input.params);

      if (channelName === 'WHATSAPP') {
        const result = await this.whatsapp.send({
          phone: user.phone,
          body,
          params: input.params,
          whatsappTemplateName: resolved.whatsappTemplateName ?? undefined,
        });
        const log = await this.logAttempt({
          studioId: input.studioId,
          phone: user.phone,
          channel,
          type: input.template,
          content: input.sensitive ? REDACTED : body,
          status: result.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
          providerMessageId: result.providerMessageId,
          errorMessage: result.errorMessage,
          fallbackOfId,
        });
        if (result.success) return { success: true, channel: 'WHATSAPP', providerMessageId: result.providerMessageId };
        fallbackOfId = log.id;
        lastReason = result.errorMessage ?? 'WhatsApp gönderimi başarısız';
        continue;
      }

      // SMS branch: reserve the tenant's credit before attempting the send.
      let reservation: { walletId: string; balanceAfter: number } | null = null;
      if (input.studioId) {
        reservation = await this.reserveSmsCredit(input.studioId);
        if (!reservation) {
          await this.logAttempt({
            studioId: input.studioId,
            phone: user.phone,
            channel,
            type: input.template,
            content: input.sensitive ? REDACTED : body,
            status: NotificationStatus.FAILED,
            errorMessage: 'Stüdyo SMS kredisi yetersiz',
            fallbackOfId,
          });
          lastReason = 'Stüdyo SMS kredisi yetersiz';
          continue;
        }
      }

      const smsResult = await this.getSmsAdapter().send({ phone: user.phone, body, params: input.params, senderName: settings.smsSenderName });
      const log = await this.logAttempt({
        studioId: input.studioId,
        phone: user.phone,
        channel,
        type: input.template,
        content: input.sensitive ? REDACTED : body,
        status: smsResult.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
        providerMessageId: smsResult.providerMessageId,
        errorMessage: smsResult.errorMessage,
        fallbackOfId,
      });

      if (smsResult.success) {
        if (input.studioId && reservation) {
          await this.prisma.smsTransaction.create({
            data: {
              studioId: input.studioId,
              walletId: reservation.walletId,
              type: 'USAGE',
              amount: -1,
              balanceAfter: reservation.balanceAfter,
              notificationLogId: log.id,
            },
          });
        }
        return { success: true, channel: 'SMS', providerMessageId: smsResult.providerMessageId };
      }

      // Send failed after the credit was reserved: give it back. No ledger
      // entry, since nothing was actually delivered (rule 8).
      if (input.studioId && reservation) await this.refundSmsCredit(input.studioId);
      fallbackOfId = log.id;
      lastReason = smsResult.errorMessage ?? 'SMS gönderimi başarısız';
    }

    return { success: false, reason: lastReason };
  }

  private getSmsAdapter(): MessageChannel {
    const provider = this.config.get<string>('SMS_PROVIDER', 'MOCK');
    return provider === 'ILETI_MERKEZI' ? this.iletiMerkezi : this.netgsm;
  }

  private async reserveSmsCredit(studioId: string): Promise<{ walletId: string; balanceAfter: number } | null> {
    const wallet = await this.prisma.smsWallet.findUnique({ where: { studioId } });
    if (!wallet) return null;
    const reserved = await this.prisma.smsWallet.updateMany({
      where: { studioId, balance: { gte: 1 } },
      data: { balance: { decrement: 1 } },
    });
    if (reserved.count === 0) return null;
    const updated = await this.prisma.smsWallet.findUniqueOrThrow({ where: { studioId } });
    return { walletId: wallet.id, balanceAfter: updated.balance };
  }

  private async refundSmsCredit(studioId: string): Promise<void> {
    await this.prisma.smsWallet.updateMany({ where: { studioId }, data: { balance: { increment: 1 } } });
  }

  private async logAttempt(params: {
    studioId: string | null;
    phone: string;
    channel: NotificationChannel;
    type: string;
    content: string;
    status: NotificationStatus;
    providerMessageId?: string;
    errorMessage?: string;
    fallbackOfId?: string;
  }) {
    return this.prisma.notificationLog.create({
      data: {
        studioId: params.studioId,
        recipientPhone: params.phone,
        channel: params.channel,
        type: params.type,
        content: params.content,
        status: params.status,
        providerMessageId: params.providerMessageId,
        errorMessage: params.errorMessage,
        fallbackOfId: params.fallbackOfId,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Legacy entry points, kept working as-is for existing call sites
  // (OTP, invites, schedule notifications): free-form text, SMS only, no
  // wallet gating (never blocked by SMS credit so identity flows can't
  // fail on billing) and no consent gating (always transactional).
  // ---------------------------------------------------------------------

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
      const result = await this.getSmsAdapter().send({ phone: params.phone, body: params.message, params: {} });
      if (!result.success) {
        this.logger.error(`SMS sending failed: ${result.errorMessage}`);
        await this.logNotification(params, NotificationStatus.FAILED, result.errorMessage);
        return { success: false };
      }
      await this.logNotification(params, NotificationStatus.SENT);
      return { success: true, messageId: result.providerMessageId };
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
