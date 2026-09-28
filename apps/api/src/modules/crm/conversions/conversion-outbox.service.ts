import { Injectable } from '@nestjs/common';
import { CONVERSION_DELIVERY_TARGETS } from '@platform/shared';
import type { ConversionDeliveryTarget } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AdConnectionResolver } from './ad-connection.resolver';

export interface OutboxEvent {
  id: string;
  studioId: string;
  isTest: boolean;
}

/**
 * Ad platform outbox (docs/BUYUME_VE_GLOBAL_MIMARI.md 3.3). One PENDING
 * ConversionDelivery per connected target; test events are never queued.
 * The delivery worker (retries, CONVERSION_RETRY_DELAYS_SECONDS) is G2b.
 */
@Injectable()
export class ConversionOutboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: AdConnectionResolver,
  ) {}

  async enqueue(event: OutboxEvent, now = new Date()): Promise<ConversionDeliveryTarget[]> {
    if (event.isTest) return [];
    const targets = (await this.connections.targetsFor(event.studioId)).filter((t) =>
      (CONVERSION_DELIVERY_TARGETS as readonly string[]).includes(t),
    );
    const unique = [...new Set(targets)];
    if (unique.length === 0) return [];
    await this.prisma.conversionDelivery.createMany({
      data: unique.map((target) => ({
        studioId: event.studioId,
        conversionEventId: event.id,
        target,
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: now,
      })),
      skipDuplicates: true,
    });
    return unique;
  }
}
