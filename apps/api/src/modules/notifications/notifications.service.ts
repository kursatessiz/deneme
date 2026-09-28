import { Injectable, Logger } from '@nestjs/common';
import type { NotificationCategory } from '@platform/shared';
import type { PushMessage } from './push.service';
import { MessagingService } from '../messaging/engine/messaging.service';

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
  /** Journeys/automations: repeat calls with the same key send once. */
  idempotencyKey?: string;
}

export interface SendResult {
  success: boolean;
  channel?: 'WHATSAPP' | 'SMS' | 'EMAIL' | 'PUSH' | 'IN_APP';
  providerMessageId?: string;
  /** Why no channel could deliver the message (or why it was skipped). */
  reason?: string;
}

/**
 * Compatibility facade over MessagingService (G1c). Every existing caller
 * (automations, reminders, dunning, gamification, ratings, invites, OTP)
 * keeps its call shape; each method now goes through the single messaging
 * engine, so consent, quiet hours, frequency caps, provider selection,
 * delivery records and SMS credit rules apply uniformly.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly messaging: MessagingService) {}

  /**
   * Template send on the tenant's channel order (WhatsApp -> SMS by
   * default), honouring the member's category toggle. Non-transactional
   * templates are commercial: consent, quiet hours and frequency caps apply.
   */
  async send(input: SendParams): Promise<SendResult> {
    const result = await this.messaging.send({
      studioId: input.studioId,
      recipient: { userId: input.userId },
      templateKey: input.template,
      variables: input.params,
      category: input.category,
      sensitive: input.sensitive,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      success: result.success,
      channel: result.channel,
      providerMessageId: result.providerMessageId,
      reason: result.success ? undefined : result.reason,
    };
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
    const pushed = await this.messaging.send({
      studioId: params.studioId,
      recipient: { userId: params.userId },
      channel: 'PUSH',
      purpose: 'TRANSACTIONAL',
      category: params.category,
      type: params.category,
      content: { subject: params.message.title, text: params.message.body, data: params.message.data },
    });

    let smsSent = false;
    if (params.smsText) {
      const sms = await this.messaging.send({
        studioId: params.studioId,
        recipient: { userId: params.userId },
        channel: 'SMS',
        purpose: 'TRANSACTIONAL',
        category: params.category,
        type: 'REMINDER',
        content: { text: params.smsText },
        billing: 'EXEMPT',
      });
      smsSent = sms.success;
    }
    return { push: pushed.pushedDevices ?? 0, sms: smsSent };
  }

  /**
   * Transactional template to a raw phone number (invitees have no account
   * yet): wallet-exempt like every identity flow, tried on the given
   * channels in order (WhatsApp, then SMS for a WhatsApp invite).
   */
  async sendTemplateToPhone(params: {
    studioId: string;
    phone: string;
    templateKey: string;
    variables: Record<string, string>;
    channels: ('WHATSAPP' | 'SMS')[];
    type: string;
    locale?: string | null;
    sensitive?: boolean;
  }): Promise<{ success: boolean; channel?: SendResult['channel'] }> {
    const result = await this.messaging.send({
      studioId: params.studioId,
      recipient: { phone: params.phone },
      channels: params.channels,
      purpose: 'TRANSACTIONAL',
      templateKey: params.templateKey,
      variables: params.variables,
      locale: params.locale,
      type: params.type,
      sensitive: params.sensitive,
      billing: 'EXEMPT',
    });
    if (!result.success) this.logger.error(`${params.type} could not be sent: ${result.reason ?? 'unknown'}`);
    return { success: result.success, channel: result.channel };
  }

  /**
   * Free-text SMS for identity flows (login and invite codes, invite
   * links): transactional, never blocked by the tenant's SMS wallet, never
   * gated by consent, content redacted when sensitive.
   */
  async sendSms(params: SendSmsParams): Promise<{ success: boolean; messageId?: string }> {
    this.logger.log(`[SMS Queue] To: ${params.phone} | Type: ${params.type}`);
    const result = await this.messaging.send({
      studioId: params.studioId,
      recipient: { phone: params.phone },
      channel: 'SMS',
      purpose: 'TRANSACTIONAL',
      type: params.type,
      content: { text: params.message },
      sensitive: params.sensitive,
      billing: 'EXEMPT',
    });
    if (!result.success) this.logger.error(`SMS sending failed: ${result.reason ?? 'unknown'}`);
    return { success: result.success, messageId: result.providerMessageId };
  }
}
