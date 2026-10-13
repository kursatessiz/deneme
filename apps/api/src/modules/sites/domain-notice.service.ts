import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMAIN_DEACTIVATED_TEMPLATE_KEY, DOMAIN_VERIFY_WARNING_TEMPLATE_KEY } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/engine/messaging.service';

/** The permission that guards the site and domain endpoints (sites-tenant.controller.ts). */
export const SITE_MANAGE_PERMISSION = 'site.manage';

export interface DomainNoticeTarget {
  /** SiteDomain id, part of the idempotency key. */
  domainId: string;
  domain: string;
  studioId: string;
  isPlatformStudio: boolean;
  /** Instant of the re-check; keeps the idempotency key unique per streak, so a later failure streak notifies again. */
  eventAt: Date;
}

/**
 * Operational notices about a custom domain, sent after the daily re-check changes its state. TRANSACTIONAL
 * and billing EXEMPT, so no marketing consent or quiet hours apply and no SMS credit is spent: e-mail and an
 * in-app notice, to the studio owner and to every ACTIVE staff membership whose role holds `site.manage`.
 * Best effort: a failure is logged and never reaches the re-check job.
 */
@Injectable()
export class DomainNoticeService {
  private readonly logger = new Logger(DomainNoticeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  /** First failed re-check of a VERIFIED domain: `days` is how long until it is switched off. */
  async warnFirstFailure(target: DomainNoticeTarget, days: number, cnameTarget: string): Promise<number> {
    return this.notify(target, DOMAIN_VERIFY_WARNING_TEMPLATE_KEY, 'warning', { days, cnameTarget });
  }

  /** The domain reached the failure limit and became FAILED. */
  async notifyDeactivated(target: DomainNoticeTarget): Promise<number> {
    return this.notify(target, DOMAIN_DEACTIVATED_TEMPLATE_KEY, 'deactivated', {});
  }

  /** Memberships that must hear about the domain: owners and staff holding the site-management permission. */
  async recipients(studioId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: {
        studioId,
        status: 'ACTIVE',
        erasedAt: null,
        OR: [{ roleTemplate: { isOwner: true } }, { roleTemplate: { permissions: { some: { permissionKey: SITE_MANAGE_PERMISSION } } } }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => r.id);
  }

  private async notify(target: DomainNoticeTarget, templateKey: string, event: string, extra: Record<string, string | number>): Promise<number> {
    let sent = 0;
    try {
      const base = (this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
      const link = `${base}${target.isPlatformStudio ? '/pazarlama/site' : '/ayarlar/web-sitem'}`;
      for (const membershipId of await this.recipients(target.studioId)) {
        for (const channel of ['EMAIL', 'IN_APP'] as const) {
          try {
            const result = await this.messaging.send({
              studioId: target.studioId,
              recipient: { membershipId },
              channel,
              purpose: 'TRANSACTIONAL',
              templateKey,
              variables: { domain: target.domain, link, ...extra },
              idempotencyKey: `domain-${event}:${target.domainId}:${target.eventAt.toISOString()}:${membershipId}:${channel}`,
              type: templateKey,
              billing: 'EXEMPT',
            });
            if (result.success && !result.duplicate) sent += 1;
          } catch (err) {
            this.logger.warn(`Domain notice ${templateKey} (${channel}) not sent: ${err instanceof Error ? err.name : 'unknown'}`);
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Domain notice ${templateKey} for ${target.domain} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return sent;
  }
}
