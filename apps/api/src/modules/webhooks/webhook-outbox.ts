import { Prisma } from '@platform/database';
import type { WebhookEvent } from '@platform/shared';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Queues one PENDING delivery per active endpoint of the studio that
 * subscribes to the event; the dispatcher signs and sends them. Shared by
 * WebhooksService.emit (business events of every tenant) and
 * PlatformEventsService (platform events of the platform tenant). Callers
 * decide whether a failure may surface; this function can throw.
 */
export async function enqueueWebhookDeliveries(prisma: PrismaService, studioId: string, event: WebhookEvent, payload: Record<string, unknown>): Promise<number> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { studioId, isActive: true, events: { has: event } },
    select: { id: true },
  });
  if (endpoints.length === 0) return 0;
  const occurredAt = new Date().toISOString();
  await prisma.webhookDelivery.createMany({
    data: endpoints.map((e) => ({
      endpointId: e.id,
      event,
      payload: { event, studioId, occurredAt, data: payload } as Prisma.InputJsonValue,
      status: 'PENDING' as const,
      nextAttemptAt: new Date(),
    })),
  });
  return endpoints.length;
}
