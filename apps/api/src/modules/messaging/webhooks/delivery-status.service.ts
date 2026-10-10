import { Injectable, Logger } from '@nestjs/common';
import type { MessageTrackingEventType, NotificationChannel, NotificationLog, NotificationStatus, Prisma } from '@platform/database';
import { PrismaService } from '../../prisma/prisma.service';
import { OptOutService } from '../engine/opt-out.service';

export type DeliveryUpdateKind = 'DELIVERED' | 'READ' | 'FAILED' | 'BOUNCED' | 'COMPLAINED' | 'SENT';

export interface DeliveryUpdate {
  providerMessageId: string;
  /** When set, only logs of this channel are updated (SES events only ever concern EMAIL logs). */
  channel?: NotificationChannel;
  kind: DeliveryUpdateKind;
  /** Hard (permanent) failure: the address is undeliverable and suppressed for COMMERCIAL. */
  permanent?: boolean;
  errorMessage?: string | null;
  /** Short provider detail, e.g. "Permanent/General". */
  detail?: string | null;
  occurredAt?: Date;
}

const RANK: Record<NotificationStatus, number> = { PENDING: 0, FAILED: 1, SENT: 2, DELIVERED: 3, BOUNCED: 4, COMPLAINED: 5 };

/**
 * Applies provider delivery callbacks (SES via SNS, Twilio, WhatsApp Cloud,
 * Netgsm, İleti Merkezi) to NotificationLog. Statuses only move forward
 * (a late "sent" never overwrites "delivered"). Hard bounces and
 * complaints put the address on the suppression list, which blocks every
 * future COMMERCIAL message to it on that channel. Idempotent: replaying a
 * callback changes nothing.
 */
@Injectable()
export class DeliveryStatusService {
  private readonly logger = new Logger(DeliveryStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly optOut: OptOutService,
  ) {}

  async apply(update: DeliveryUpdate): Promise<number> {
    const logs = await this.prisma.notificationLog.findMany({ where: { providerMessageId: update.providerMessageId, ...(update.channel ? { channel: update.channel } : {}) } });
    for (const log of logs) await this.applyToLog(log, update);
    return logs.length;
  }

  private async applyToLog(log: NotificationLog, update: DeliveryUpdate): Promise<void> {
    const at = update.occurredAt ?? new Date();
    const data: Prisma.NotificationLogUpdateInput = {};
    let event: MessageTrackingEventType | null = null;
    let status: NotificationStatus | null = null;

    switch (update.kind) {
      case 'SENT':
        status = 'SENT';
        break;
      case 'DELIVERED':
        status = 'DELIVERED';
        if (!log.deliveredAt) data.deliveredAt = at;
        event = 'DELIVERY';
        break;
      case 'READ':
        status = 'DELIVERED';
        if (!log.deliveredAt) data.deliveredAt = at;
        if (!log.openedAt) data.openedAt = at;
        event = 'OPEN';
        break;
      case 'FAILED':
        status = update.permanent ? 'BOUNCED' : 'FAILED';
        if (update.permanent && !log.bouncedAt) data.bouncedAt = at;
        if (update.permanent) event = 'BOUNCE';
        break;
      case 'BOUNCED':
        status = update.permanent === false ? 'FAILED' : 'BOUNCED';
        if (update.permanent !== false && !log.bouncedAt) data.bouncedAt = at;
        event = 'BOUNCE';
        break;
      case 'COMPLAINED':
        status = 'COMPLAINED';
        if (!log.complainedAt) data.complainedAt = at;
        event = 'COMPLAINT';
        break;
    }
    if (status && RANK[status] > RANK[log.status]) data.status = status;
    if (update.errorMessage) data.errorMessage = update.errorMessage.slice(0, 2000);
    if (Object.keys(data).length > 0) {
      await this.prisma.notificationLog.update({ where: { id: log.id }, data });
      if (data.status) {
        await this.prisma.conversationMessage.updateMany({ where: { notificationLogId: log.id }, data: { status: data.status as string } });
      }
    }
    if (event && log.studioId) {
      const duplicate = await this.prisma.messageTrackingEvent.findFirst({
        where: { notificationLogId: log.id, type: event },
        select: { id: true },
      });
      if (!duplicate) {
        await this.prisma.messageTrackingEvent.create({
          data: { studioId: log.studioId, notificationLogId: log.id, type: event, detail: update.detail?.slice(0, 80) ?? null, occurredAt: at },
        });
      }
    }

    const undeliverable = (update.kind === 'BOUNCED' && update.permanent !== false) || (update.kind === 'FAILED' && update.permanent);
    if ((undeliverable || update.kind === 'COMPLAINED') && log.studioId) {
      const address = log.channel === 'EMAIL' ? log.recipientEmail : log.recipientPhone;
      if (!address) return;
      await this.optOut.suppress({
        studioId: log.studioId,
        channel: log.channel,
        address,
        reason: update.kind === 'COMPLAINED' ? 'COMPLAINED' : 'BOUNCED',
        contactId: log.contactId,
        notificationLogId: log.id,
      });
      this.logger.log(`Suppressed ${log.channel} address after ${update.kind.toLowerCase()} (log ${log.id})`);
    }
  }
}
