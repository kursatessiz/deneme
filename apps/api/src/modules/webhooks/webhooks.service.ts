import { randomBytes } from 'crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { PrismaService } from '../prisma/prisma.service';
import { assertPublicHttpsHostname } from './ssrf-check';
import { MAX_REST_HOOKS_PER_STUDIO, WEBHOOK_EVENTS, isWebhookEvent } from '@platform/shared';
import type { CreateWebhookEndpointInput, SubscribeHookInput, UpdateWebhookEndpointInput, WebhookEvent } from '@platform/shared';
import type { TenantContext } from '../auth/tenant-context';

function generateSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

@Injectable()
export class WebhooksService {
  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Endpoint CRUD (integrations.manage)
  // ---------------------------------------------------------------------------

  async create(tenant: TenantContext, userId: string, dto: CreateWebhookEndpointInput) {
    await assertPublicHttpsHostname(dto.url);
    const secret = generateSecret();
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: { studioId: tenant.studioId, url: dto.url, secret, events: dto.events, isActive: dto.isActive },
    });
    await this.audit(tenant.studioId, userId, 'webhooks.create', endpoint.id, { url: dto.url, events: dto.events });
    return { ...this.toSummary(endpoint), secret };
  }

  async list(tenant: TenantContext) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { studioId: tenant.studioId },
      orderBy: { createdAt: 'desc' },
    });
    return endpoints.map((e) => this.toSummary(e));
  }

  async update(tenant: TenantContext, userId: string, id: string, dto: UpdateWebhookEndpointInput) {
    const endpoint = await this.findOwned(tenant.studioId, id);
    if (dto.url) await assertPublicHttpsHostname(dto.url);
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        url: dto.url,
        events: dto.events,
        isActive: dto.isActive,
        // Re-enabling manually clears the failure streak so it is not disabled again immediately.
        failureCount: dto.isActive === true ? 0 : undefined,
      },
    });
    await this.audit(tenant.studioId, userId, 'webhooks.update', id, dto);
    return this.toSummary(updated);
  }

  async remove(tenant: TenantContext, userId: string, id: string) {
    await this.findOwned(tenant.studioId, id);
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    await this.audit(tenant.studioId, userId, 'webhooks.delete', id, {});
    return { deleted: true };
  }

  async rotateSecret(tenant: TenantContext, userId: string, id: string) {
    const endpoint = await this.findOwned(tenant.studioId, id);
    const secret = generateSecret();
    const updated = await this.prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { secret } });
    await this.audit(tenant.studioId, userId, 'webhooks.rotate_secret', id, {});
    return { ...this.toSummary(updated), secret };
  }

  // ---------------------------------------------------------------------------
  // REST hooks for automation tools (G3c-3, docs/ZAPIER.md). Same table and
  // same target validation as the staff endpoints; the caller is an API key,
  // so the studio comes from the key and the audit row has no user.
  // ---------------------------------------------------------------------------

  async subscribeRestHook(studioId: string, apiKeyId: string, dto: SubscribeHookInput) {
    await assertPublicHttpsHostname(dto.targetUrl);
    const existing = await this.prisma.webhookEndpoint.count({ where: { studioId } });
    if (existing >= MAX_REST_HOOKS_PER_STUDIO) {
      throw new ConflictException('Bu işletme için en fazla webhook sayısına ulaşıldı');
    }
    const secret = generateSecret();
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: { studioId, url: dto.targetUrl, secret, events: [dto.event], isActive: true },
    });
    await this.prisma.auditLog
      .create({
        data: {
          studioId,
          action: 'webhooks.rest_hook.subscribe',
          entityType: 'WebhookEndpoint',
          entityId: endpoint.id,
          metadata: { apiKeyId, event: dto.event, url: dto.targetUrl },
        },
      })
      .catch(() => undefined);
    return { id: endpoint.id, event: dto.event, targetUrl: endpoint.url, secret, createdAt: endpoint.createdAt };
  }

  /** The studio filter is the whole authorisation: another studio's hook id is a plain 404. */
  async unsubscribeRestHook(studioId: string, apiKeyId: string, id: string) {
    const endpoint = await this.findOwned(studioId, id);
    await this.prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
    await this.prisma.auditLog
      .create({
        data: { studioId, action: 'webhooks.rest_hook.unsubscribe', entityType: 'WebhookEndpoint', entityId: id, metadata: { apiKeyId } },
      })
      .catch(() => undefined);
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Deliveries
  // ---------------------------------------------------------------------------

  async listDeliveries(tenant: TenantContext, endpointId: string, page = 1, pageSize = 20) {
    await this.findOwned(tenant.studioId, endpointId);
    const [items, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where: { endpointId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.webhookDelivery.count({ where: { endpointId } }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Re-queues an existing delivery for a fresh attempt, regardless of its current status. */
  async redeliver(tenant: TenantContext, userId: string, endpointId: string, deliveryId: string) {
    await this.findOwned(tenant.studioId, endpointId);
    const delivery = await this.prisma.webhookDelivery.findFirst({ where: { id: deliveryId, endpointId } });
    if (!delivery) throw new NotFoundException('Teslimat kaydı bulunamadı');
    const updated = await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'PENDING', nextAttemptAt: new Date(), lastError: null },
    });
    await this.audit(tenant.studioId, userId, 'webhooks.redeliver', endpointId, { deliveryId });
    return updated;
  }

  async sendTestEvent(tenant: TenantContext, userId: string, endpointId: string, event: WebhookEvent) {
    const endpoint = await this.findOwned(tenant.studioId, endpointId);
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        event,
        payload: { test: true, event, studioId: tenant.studioId, sentAt: new Date().toISOString() },
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
    });
    await this.audit(tenant.studioId, userId, 'webhooks.test_event', endpointId, { event });
    return delivery;
  }

  // ---------------------------------------------------------------------------
  // Outbox: called from the services that emit business events. Best-effort
  // only -- any error here is swallowed so a webhook problem can never break
  // the caller's own transaction/response (see CLAUDE.md rule 8 note in the
  // W18 task and docs/PUBLIC_API.md "Retry policy").
  // ---------------------------------------------------------------------------

  async emit(studioId: string, event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { studioId, isActive: true, events: { has: event } },
        select: { id: true },
      });
      if (endpoints.length === 0) return;
      await this.prisma.webhookDelivery.createMany({
        data: endpoints.map((e) => ({
          endpointId: e.id,
          event,
          payload: { event, studioId, occurredAt: new Date().toISOString(), data: payload } as Prisma.InputJsonValue,
          status: 'PENDING' as const,
          nextAttemptAt: new Date(),
        })),
      });
    } catch {
      // Never let a webhook outbox failure surface to the caller.
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async findOwned(studioId: string, id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id, studioId } });
    if (!endpoint) throw new NotFoundException('Webhook uç noktası bulunamadı');
    return endpoint;
  }

  private toSummary(endpoint: {
    id: string;
    url: string;
    events: string[];
    isActive: boolean;
    failureCount: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events.filter(isWebhookEvent),
      isActive: endpoint.isActive,
      failureCount: endpoint.failureCount,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    };
  }

  private async audit(studioId: string, userId: string, action: string, entityId: string, metadata: unknown) {
    await this.prisma.auditLog.create({
      data: { studioId, userId, action, entityType: 'WebhookEndpoint', entityId, metadata: metadata as never },
    }).catch(() => undefined);
  }
}

export const AVAILABLE_WEBHOOK_EVENTS = WEBHOOK_EVENTS;
