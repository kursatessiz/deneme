import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_ALERT_TEMPLATE_KEYS, truncate } from '@platform/shared';
import type { ErrorAlertKind } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/engine/messaging.service';
import type { RecordedError } from './error-store.service';

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
 * window: the send is claimed with a conditional update of lastAlertAt, so
 * concurrent writers cannot both send. Ignored groups never alert.
 */
@Injectable()
export class ErrorAlertsService {
  private readonly logger = new Logger(ErrorAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly messaging: MessagingService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('ERROR_ALERTS_ENABLED') !== '0';
  }

  private get cooldownMs(): number {
    return (this.config.get<number>('ERROR_ALERT_COOLDOWN_MINUTES') ?? 60) * 60 * 1000;
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

    const claimed = await this.prisma.errorGroup.updateMany({
      where: {
        id: recorded.group.id,
        status: { not: 'IGNORED' },
        OR: [{ lastAlertAt: null }, { lastAlertAt: { lt: new Date(now.getTime() - this.cooldownMs) } }],
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
    return kind;
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
      this.prisma.errorGroup.count({ where: { firstSeenAt: { gte: since } } }),
      this.prisma.errorGroup.count({ where: { status: 'OPEN' } }),
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
  private async sendToSuperAdmins(templateKey: string, variables: Record<string, string | number>): Promise<number> {
    const admins = await this.prisma.user.findMany({
      where: { isSuperAdmin: true, isActive: true, email: { not: null } },
      select: { id: true },
    });
    let accepted = 0;
    for (const admin of admins) {
      try {
        const result = await this.messaging.send({
          studioId: null,
          recipient: { userId: admin.id },
          channel: 'EMAIL',
          purpose: 'TRANSACTIONAL',
          templateKey,
          variables,
          type: templateKey,
          billing: 'EXEMPT',
        });
        if (result.success) accepted++;
      } catch (err) {
        this.logger.warn(`Error alert ${templateKey} could not be sent: ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }
    return accepted;
  }
}
