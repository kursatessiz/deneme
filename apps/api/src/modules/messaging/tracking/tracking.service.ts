import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@platform/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AttributionService } from '../../crm/attribution/attribution.service';
import { isLikelyBot } from '../../crm/tracking/tracking-utils';
import { OptOutService, normalizeAddress } from '../engine/opt-out.service';
import { MessagingUrls } from './messaging-urls.service';

/**
 * Privacy-proxy and security-scanner fetches: Apple Mail Privacy Protection
 * prefetches every image with a bare "Mozilla/5.0" user agent; mail
 * gateways scan links and pixels. Such events are stored but marked
 * machine, and never counted as a human open or click.
 */
export function isMachineFetch(userAgent: string | undefined): { machine: boolean; detail: string | null } {
  const ua = (userAgent ?? '').trim();
  if (ua === 'Mozilla/5.0') return { machine: true, detail: 'apple_mpp' };
  if (ua === '' || isLikelyBot(ua)) return { machine: true, detail: 'scanner' };
  const lower = ua.slice(0, 512).toLowerCase();
  for (const needle of ['barracuda', 'mimecast', 'proofpoint', 'safelinks', 'messagelabs', 'symantec', 'trendmicro']) {
    if (lower.includes(needle)) return { machine: true, detail: 'scanner' };
  }
  return { machine: false, detail: null };
}

export interface UnsubscribeInfo {
  studioName: string;
  channel: NotificationChannel;
  maskedAddress: string;
  alreadyUnsubscribed: boolean;
}

export function maskAddress(channel: NotificationChannel, address: string): string {
  if (channel === 'EMAIL') {
    const [local, domain] = address.split('@');
    if (!domain) return '***';
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return address.length > 4 ? `${'*'.repeat(Math.max(0, address.length - 4))}${address.slice(-4)}` : '****';
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: MessagingUrls,
    private readonly attribution: AttributionService,
    private readonly optOut: OptOutService,
  ) {}

  /** Open pixel (commercial email only). Never throws: the pixel is always served. */
  async recordOpen(token: string, userAgent: string | undefined): Promise<void> {
    const logId = this.urls.verify(token, 'o');
    if (!logId) return;
    try {
      const log = await this.prisma.notificationLog.findUnique({ where: { id: logId } });
      if (!log || !log.studioId || log.channel !== 'EMAIL' || log.purpose !== 'COMMERCIAL') return;
      const { machine, detail } = isMachineFetch(userAgent);
      const now = new Date();
      await this.prisma.messageTrackingEvent.create({
        data: { studioId: log.studioId, notificationLogId: log.id, type: 'OPEN', isMachine: machine, detail },
      });
      if (machine) {
        if (!log.machineOpenedAt) await this.prisma.notificationLog.update({ where: { id: log.id }, data: { machineOpenedAt: now } });
      } else if (!log.openedAt) {
        await this.prisma.notificationLog.update({ where: { id: log.id }, data: { openedAt: now } });
      }
    } catch (err) {
      this.logger.warn(`Open tracking failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Resolves a click token to its stored target and records the click.
   * With the visitor cookie (pw_vid) the contact is linked to that visitor
   * for attribution (AttributionService.identify). Null for any bad token:
   * the caller redirects to the site root, never to a caller-supplied URL.
   */
  async recordClick(token: string, userAgent: string | undefined, visitorId: string | null): Promise<string | null> {
    const linkId = this.urls.verify(token, 'c');
    if (!linkId) return null;
    const link = await this.prisma.messageLink.findUnique({ where: { id: linkId }, include: { notificationLog: true } });
    if (!link) return null;
    try {
      const { machine, detail } = isMachineFetch(userAgent);
      await this.prisma.messageTrackingEvent.create({
        data: { studioId: link.studioId, notificationLogId: link.notificationLogId, type: 'CLICK', isMachine: machine, detail, linkId: link.id },
      });
      if (!machine) {
        if (!link.notificationLog.clickedAt) {
          await this.prisma.notificationLog.update({ where: { id: link.notificationLogId }, data: { clickedAt: new Date() } });
        }
        if (visitorId && link.notificationLog.contactId) {
          await this.attribution.identify(link.studioId, visitorId, link.notificationLog.contactId);
        }
      }
    } catch (err) {
      this.logger.warn(`Click tracking failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return link.url;
  }

  private async logForUnsubscribe(token: string) {
    const logId = this.urls.verify(token, 'u');
    if (!logId) return null;
    const log = await this.prisma.notificationLog.findUnique({
      where: { id: logId },
      include: { studio: { select: { name: true, countryCode: true } }, contact: { select: { countryCode: true } } },
    });
    if (!log || !log.studioId || !log.studio) return null;
    const address = log.channel === 'EMAIL' ? log.recipientEmail : log.recipientPhone;
    if (!address) return null;
    return { log, address, studioId: log.studioId, studio: log.studio };
  }

  async unsubscribeInfo(token: string): Promise<UnsubscribeInfo | null> {
    const found = await this.logForUnsubscribe(token);
    if (!found) return null;
    const already = await this.optOut.isSuppressed(found.studioId, found.log.channel, found.address);
    return {
      studioName: found.studio.name,
      channel: found.log.channel,
      maskedAddress: maskAddress(found.log.channel, normalizeAddress(found.log.channel, found.address)),
      alreadyUnsubscribed: already,
    };
  }

  /** One-click unsubscribe (RFC 8058) and the web page's button. Idempotent. */
  async unsubscribe(token: string): Promise<{ unsubscribed: true; alreadyUnsubscribed: boolean } | null> {
    const found = await this.logForUnsubscribe(token);
    if (!found) return null;
    const { log } = found;
    const created = await this.optOut.optOut({
      studioId: found.studioId,
      channel: log.channel,
      address: found.address,
      reason: 'UNSUBSCRIBED',
      contactId: log.contactId,
      userId: log.userId,
      notificationLogId: log.id,
      countryCode: log.contact?.countryCode ?? found.studio.countryCode,
      source: 'unsubscribe-link',
    });
    if (created) {
      await this.prisma.messageTrackingEvent.create({
        data: { studioId: found.studioId, notificationLogId: log.id, type: 'UNSUBSCRIBE' },
      });
    }
    return { unsubscribed: true, alreadyUnsubscribed: !created };
  }
}
