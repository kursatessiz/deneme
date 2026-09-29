import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ErrorAlert } from '@platform/database';
import { ERROR_ALERT_TEMPLATE_KEYS, truncate } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AlertSinkDispatcher } from './alert-sinks/alert-sink-dispatcher.service';
import { ErrorAlertMailer } from './error-alert-mailer.service';
import { ErrorAlertRecordsService } from './error-alert-records.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Subjects carry the title; NotificationLog.subject is 200 characters. */
const TITLE_IN_ALERT = 120;

export interface PublishOptions {
  /** Send the ERROR_SPIKE e-mail to super admins (NEW_GROUP and REGRESSION already have their own e-mail path). */
  emailAdmins: boolean;
  /** Studios whose owners may be told about a NEW_GROUP (the event's studio). SPIKE looks its studios up itself. */
  studioIds?: string[];
  now?: Date;
}

/**
 * What happens once an alert row exists (H3): the super admin e-mail for a
 * spike, delivery to the configured sinks (signed webhook, Slack) and the
 * opt-in tenant owner notice. Each step is isolated: one failing never
 * blocks the others or loses the alert.
 */
@Injectable()
export class ErrorAlertNotifier {
  private readonly logger = new Logger(ErrorAlertNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: ErrorAlertMailer,
    private readonly sinks: AlertSinkDispatcher,
    private readonly records: ErrorAlertRecordsService,
  ) {}

  async publish(alert: ErrorAlert, options: PublishOptions): Promise<void> {
    const now = options.now ?? new Date();
    const group = await this.prisma.errorGroup.findUnique({ where: { id: alert.groupId } });
    if (!group) return;

    if (options.emailAdmins) {
      try {
        await this.mailer.sendToSuperAdmins(ERROR_ALERT_TEMPLATE_KEYS.spike, {
          title: truncate(group.title, TITLE_IN_ALERT),
          source: group.source,
          release: group.lastRelease ?? '-',
          code: group.lastCode ?? '-',
          windowCount: alert.windowCount,
          baselineMean: alert.baselineMean,
          threshold: alert.threshold,
          link: `${this.appUrl()}/admin/hatalar/${group.id}`,
        });
      } catch (err) {
        this.logger.warn(`Spike e-mail failed: ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }

    await this.sinks.dispatch(alert.id, now);

    try {
      await this.notifyOwners(alert, group.id, options, now);
    } catch (err) {
      this.logger.warn(`Owner notice failed: ${err instanceof Error ? err.name : 'unknown'}`);
    }

    try {
      await this.records.markNotified(alert.id, now);
    } catch {
      // The alert exists and was delivered; the timestamp is informational.
    }
  }

  /**
   * NEW_GROUP and SPIKE only: e-mails the owner of every affected studio that
   * opted in, at most once per group and studio per 24 hours (the send is
   * claimed with a conditional update of ownerNotifiedAt, so parallel writers
   * cannot both send).
   */
  private async notifyOwners(alert: ErrorAlert, groupId: string, options: PublishOptions, now: Date): Promise<void> {
    if (alert.kind !== 'SPIKE' && alert.kind !== 'NEW_GROUP') return;
    let studioIds: string[];
    if (alert.kind === 'SPIKE') {
      const affected = await this.prisma.errorGroupStudio.findMany({
        where: { groupId, lastSeenAt: { gte: alert.windowStart } },
        select: { studioId: true },
        take: 500,
      });
      studioIds = affected.map((s) => s.studioId);
    } else {
      studioIds = options.studioIds ?? [];
    }
    if (studioIds.length === 0) return;

    const optedIn = await this.prisma.errorStudioSetting.findMany({
      where: { studioId: { in: studioIds }, ownerNotify: true },
      select: { studioId: true },
    });
    for (const { studioId } of optedIn) {
      const claimed = await this.prisma.errorGroupStudio.updateMany({
        where: { groupId, studioId, OR: [{ ownerNotifiedAt: null }, { ownerNotifiedAt: { lt: new Date(now.getTime() - DAY_MS) } }] },
        data: { ownerNotifiedAt: now },
      });
      if (claimed.count === 0) continue;
      const row = await this.prisma.errorGroupStudio.findUnique({ where: { groupId_studioId: { groupId, studioId } }, select: { lastCode: true } });
      await this.mailer.sendToOwner(studioId, ERROR_ALERT_TEMPLATE_KEYS.ownerNotice, {
        code: row?.lastCode ?? '-',
        link: `${this.appUrl()}/ayarlar/hatalar`,
      });
    }
  }

  private appUrl(): string {
    return (this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  }
}
