import { Injectable, Logger } from '@nestjs/common';
import type { PlatformWebhookEvent } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { enqueueWebhookDeliveries } from './webhook-outbox';

/**
 * Platform events (M4c, docs/PAZARLAMA_MODULU.md 5.2): studio.signup,
 * studio.paid, studio.trial_expiring, contact.lifecycle_changed and
 * campaign.sent. They describe the platform's own business, so they are
 * queued only for the webhook endpoints of the platform tenant
 * (Studio.isPlatform), through the same outbox, signing, retry and SSRF
 * rules as every other event. Other tenants never see them. Like
 * WebhooksService.emit, nothing here throws into the caller's flow.
 *
 * This service depends on Prisma only, so the CRM, billing and growth
 * modules can use it without importing WebhooksModule.
 */
@Injectable()
export class PlatformEventsService {
  private readonly logger = new Logger(PlatformEventsService.name);
  private platformId: string | null = null;

  /** The platform tenant's id, or null when none exists yet. */
  async platformStudioId(): Promise<string | null> {
    if (this.platformId) return this.platformId;
    const studio = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true } });
    this.platformId = studio?.id ?? null;
    return this.platformId;
  }

  constructor(private readonly prisma: PrismaService) {}

  /** Emits an event about the platform's business to the platform tenant's subscriptions. */
  async emit(event: PlatformWebhookEvent, data: Record<string, unknown>): Promise<void> {
    try {
      const platformId = await this.platformStudioId();
      if (!platformId) return;
      await enqueueWebhookDeliveries(this.prisma, platformId, event, data);
    } catch (err) {
      this.logger.warn(`Platform event ${event} not queued: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Emits only when the subject belongs to the platform tenant (contacts and campaigns of any other tenant are ignored). */
  async emitForStudio(studioId: string, event: PlatformWebhookEvent, data: Record<string, unknown>): Promise<void> {
    try {
      const platformId = await this.platformStudioId();
      if (!platformId || platformId !== studioId) return;
      await enqueueWebhookDeliveries(this.prisma, platformId, event, data);
    } catch (err) {
      this.logger.warn(`Platform event ${event} not queued: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
