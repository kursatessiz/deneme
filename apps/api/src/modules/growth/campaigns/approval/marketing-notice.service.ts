import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import { BASE_MESSAGES, BUNDLED_MESSAGES, createTranslator } from '@platform/shared';
import type { Translate } from '@platform/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { MessagingService } from '../../../messaging/engine/messaging.service';

export interface NoticeRecipient {
  id: string;
  locale: string | null;
}

export type NoticeChannel = 'EMAIL' | 'IN_APP';

/**
 * Operational notices of the platform's own marketing (M3d): the
 * deliverability fuse, the ad spend cap and the weekly summary. Everything
 * goes through the messaging engine as TRANSACTIONAL messages (e-mail and an
 * in-app notice), in the recipient's language. A notice that is rate limited
 * ("once per 24 hours per reason", "once per month per currency") leaves an
 * AuditLog row (`marketing.alert.sent`) that the next check looks for, so the
 * limit survives restarts and several workers.
 */
@Injectable()
export class MarketingNoticeService {
  private readonly logger = new Logger(MarketingNoticeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  translator(locale: string | null): { t: Translate; locale: string } {
    const code = locale && BUNDLED_MESSAGES[locale] ? locale : 'tr';
    return { t: createTranslator({ locale: code, messages: BUNDLED_MESSAGES[code] ?? BASE_MESSAGES, fallback: BASE_MESSAGES }), locale: code };
  }

  /** Link into the marketing panel. */
  link(path = '/pazarlama'): string {
    const base = (this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
    return `${base}${path}`;
  }

  async superAdmins(): Promise<NoticeRecipient[]> {
    return this.prisma.user.findMany({ where: { isSuperAdmin: true, isActive: true }, select: { id: true, locale: true }, orderBy: { id: 'asc' } });
  }

  /** One message per channel; a failure is logged and never fails the caller. */
  async deliver(
    studioId: string,
    userId: string,
    templateKey: string,
    variables: Record<string, string | number>,
    channels: readonly NoticeChannel[] = ['EMAIL', 'IN_APP'],
  ): Promise<void> {
    for (const channel of channels) {
      try {
        await this.messaging.send({
          studioId,
          recipient: { userId },
          channel,
          purpose: 'TRANSACTIONAL',
          templateKey,
          variables,
          type: templateKey,
          billing: 'EXEMPT',
        });
      } catch (err) {
        this.logger.warn(`Marketing notice ${templateKey} (${channel}) not sent: ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }
  }

  /**
   * Sends the notice to every super admin unless one with the same `key` was
   * already sent at or after `since`. The audit row is written first, so two
   * workers that race send at most one round of messages in practice.
   * Returns true when the notice went out.
   */
  async alertSuperAdminsOnce(input: {
    studioId: string;
    key: string;
    since: Date;
    now: Date;
    templateKey: string;
    variablesFor: (t: Translate, locale: string) => Record<string, string | number>;
  }): Promise<boolean> {
    const already = await this.prisma.auditLog.findFirst({
      where: { studioId: input.studioId, action: 'marketing.alert.sent', entityId: input.key, createdAt: { gte: input.since } },
      select: { id: true },
    });
    if (already) return false;
    await this.prisma.auditLog.create({
      data: {
        studioId: input.studioId,
        userId: null,
        action: 'marketing.alert.sent',
        entityType: 'MarketingAlert',
        entityId: input.key,
        // The instant of the check, so the rate limit reads the same clock the caller uses.
        createdAt: input.now,
        metadata: { template: input.templateKey } as Prisma.InputJsonValue,
      },
    });
    for (const admin of await this.superAdmins()) {
      const { t, locale } = this.translator(admin.locale);
      await this.deliver(input.studioId, admin.id, input.templateKey, input.variablesFor(t, locale));
    }
    return true;
  }
}
