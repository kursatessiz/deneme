import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_ALERT_TEMPLATE_KEYS, truncate } from '@platform/shared';
import type { ErrorAlertKind } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RecordedError } from './error-store.service';
import { ErrorAlertMailer } from './error-alert-mailer.service';
import { ErrorAlertNotifier } from './error-alert-notifier.service';
import { ErrorAlertRecordsService } from './error-alert-records.service';
import { ErrorSettingsService } from './error-settings.service';

const HOUR_MS = 60 * 60 * 1000;
const DIGEST_INTERVAL_MS = 23 * HOUR_MS;
/** Subjects carry the title; NotificationLog.subject is 200 characters. */
const TITLE_IN_ALERT = 120;

export interface DigestResult {
  sent: boolean;
  events: number;
  newGroups: number;
}

/**
 * Email-only alerts to super admins through the messaging engine
 * (TRANSACTIONAL templates ERROR_*): a new group, a regression, or any
 * error on a critical flow. Each group alerts at most once per cooldown
 * window (the platform setting, ERROR_ALERT_COOLDOWN_MINUTES until it is
 * saved): the send is claimed with a conditional update of lastAlertAt, so
 * concurrent writers cannot both send. Ignored groups never alert. A new
 * group or a regression also becomes an error_alerts row (H3) that is fanned
 * out to the alert sinks and, for a new group, the opted-in tenant owner.
 */
@Injectable()
export class ErrorAlertsService {
  private readonly logger = new Logger(ErrorAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: ErrorAlertMailer,
    private readonly settings: ErrorSettingsService,
    private readonly records: ErrorAlertRecordsService,
    private readonly notifier: ErrorAlertNotifier,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('ERROR_ALERTS_ENABLED') !== '0';
  }

  /** Which alert (if any) this occurrence deserves; a regression outranks a critical flow, which outranks a new group. */
  static kindFor(recorded: Pick<RecordedError, 'isNew' | 'regression' | 'critical'> & { status: string }): ErrorAlertKind | null {
    if (recorded.status === 'IGNORED') return null;
    if (recorded.regression) return 'REGRESSION';
    if (recorded.critical) return 'CRITICAL';
    if (recorded.isNew) return 'NEW';
    return null;
  }

  async onRecorded(recorded: RecordedError, now = new Date()): Promise<ErrorAlertKind | null> {
    if (!this.enabled) return null;
    const kind = ErrorAlertsService.kindFor({ ...recorded, status: recorded.group.status });
    if (!kind) return null;

    const cooldownMs = (await this.settings.getCooldownMinutes()) * 60 * 1000;
    const claimed = await this.prisma.errorGroup.updateMany({
      where: {
        id: recorded.group.id,
        status: { not: 'IGNORED' },
        OR: [{ lastAlertAt: null }, { lastAlertAt: { lt: new Date(now.getTime() - cooldownMs) } }],
      },
      data: { lastAlertAt: now },
    });
    if (claimed.count === 0) return null;

    const group = recorded.group;
    const templateKey =
      kind === 'REGRESSION' ? ERROR_ALERT_TEMPLATE_KEYS.regression : kind === 'CRITICAL' ? ERROR_ALERT_TEMPLATE_KEYS.critical : ERROR_ALERT_TEMPLATE_KEYS.newGroup;
    const variables: Record<string, string | number> = {
      title: truncate(group.title, TITLE_IN_ALERT),
      source: group.source,
      release: group.lastRelease ?? '-',
      resolvedInRelease: group.resolvedInRelease ?? '-',
      code: recorded.code,
      route: recorded.route ?? '-',
      count: group.count,
      link: this.groupLink(group.id),
    };
    const recipients = await this.sendToSuperAdmins(templateKey, variables);
    await this.prisma.auditLog.create({
      data: {
        studioId: null,
        userId: null,
        action: 'error_group.alert_sent',
        entityType: 'ErrorGroup',
        entityId: group.id,
        metadata: { kind, templateKey, recipients, code: recorded.code },
      },
    });
    await this.recordAlert(recorded, now);
    return kind;
  }

  /** The stored alert of a new group or a regression, fanned out to the sinks and the tenant owner. */
  private async recordAlert(recorded: RecordedError, now: Date): Promise<void> {
    const kind = recorded.regression ? 'REGRESSION' : recorded.isNew ? 'NEW_GROUP' : null;
    if (!kind) return;
    try {
      const alert = await this.records.create({ groupId: recorded.group.id, kind, windowStart: now, windowEnd: now, windowCount: 1 });
      if (alert) await this.notifier.publish(alert, { emailAdmins: false, studioIds: recorded.studioId ? [recorded.studioId] : [], now });
    } catch (err) {
      this.logger.warn(`Error alert record failed for group ${recorded.group.id}: ${err instanceof Error ? err.name : 'unknown'}`);
    }
  }

  /**
   * Once a day (at the first heartbeat 23 hours after the last one), a
   * digest of the last 24 hours to super admins. Skipped when nothing was
   * recorded.
   */
  async sendDigestIfDue(now = new Date()): Promise<DigestResult> {
    const none: DigestResult = { sent: false, events: 0, newGroups: 0 };
    if (!this.enabled) return none;
    const last = await this.prisma.auditLog.findFirst({
      where: { action: 'error_reporting.digest_sent', createdAt: { gt: new Date(now.getTime() - DIGEST_INTERVAL_MS) } },
      select: { id: true },
    });
    if (last) return none;

    const since = new Date(now.getTime() - 24 * HOUR_MS);
    const [events, newGroups, openGroups, regressions, top] = await Promise.all([
      this.prisma.errorEvent.count({ where: { occurredAt: { gte: since } } }),
      this.prisma.errorGroup.count({ where: { firstSeenAt: { gte: since }, mergedIntoId: null } }),
      this.prisma.errorGroup.count({ where: { status: 'OPEN', mergedIntoId: null } }),
      this.prisma.auditLog.count({ where: { action: 'error_group.regressed', createdAt: { gte: since } } }),
      this.prisma.errorEvent.groupBy({
        by: ['groupId'],
        where: { occurredAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { groupId: 'desc' } },
        take: 5,
      }),
    ]);
    if (events === 0 && newGroups === 0) return { sent: false, events, newGroups };

    const titles = await this.prisma.errorGroup.findMany({ where: { id: { in: top.map((t) => t.groupId) } }, select: { id: true, title: true } });
    const topGroups = top
      .map((t) => `${truncate(titles.find((g) => g.id === t.groupId)?.title ?? t.groupId, 80)} (${t._count._all})`)
      .join('; ');
    const recipients = await this.sendToSuperAdmins(ERROR_ALERT_TEMPLATE_KEYS.digest, {
      events,
      newGroups,
      openGroups,
      regressions,
      topGroups: topGroups || '-',
      link: this.listLink(),
    });
    await this.prisma.auditLog.create({
      data: {
        studioId: null,
        userId: null,
        action: 'error_reporting.digest_sent',
        entityType: 'ErrorDigest',
        entityId: now.toISOString().slice(0, 10),
        metadata: { events, newGroups, openGroups, regressions, recipients },
      },
    });
    return { sent: true, events, newGroups };
  }

  private groupLink(groupId: string): string {
    return `${this.appUrl()}/admin/hatalar/${groupId}`;
  }

  private listLink(): string {
    return `${this.appUrl()}/admin/hatalar`;
  }

  private appUrl(): string {
    return (this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  }

  /** Returns how many super admins the engine accepted the email for. */
  private sendToSuperAdmins(templateKey: string, variables: Record<string, string | number>): Promise<number> {
    return this.mailer.sendToSuperAdmins(templateKey, variables);
  }
}
