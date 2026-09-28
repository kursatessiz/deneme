import { Injectable } from '@nestjs/common';
import type { AdConnectionPlatform, ConversionDeliveryTarget } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Which ad platforms a tenant has connected for server-side conversion
 * delivery.
 */
export abstract class AdConnectionResolver {
  abstract targetsFor(studioId: string): Promise<ConversionDeliveryTarget[]>;
}

@Injectable()
export class NoAdConnectionsResolver extends AdConnectionResolver {
  async targetsFor(_studioId: string): Promise<ConversionDeliveryTarget[]> {
    return [];
  }
}

const TARGET_BY_PLATFORM: Record<AdConnectionPlatform, ConversionDeliveryTarget> = {
  META: 'META_CAPI',
  GOOGLE: 'GOOGLE_ADS',
  TIKTOK: 'TIKTOK_EVENTS',
};

/**
 * G2b: one outbox target per CONNECTED AdConnection row of the tenant.
 * DISCONNECTED and ERROR connections are skipped: a broken connection
 * should not keep piling up deliveries that can never succeed, and a
 * disabled one should not receive data it was never meant to get. Test-mode
 * connections still enqueue (they are how the pre-launch check in
 * BUYUME_VE_GLOBAL_MIMARI.md section 7 is done); ConversionOutboxService
 * already never enqueues a test *event*, independent of this.
 */
@Injectable()
export class PrismaAdConnectionResolver extends AdConnectionResolver {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async targetsFor(studioId: string): Promise<ConversionDeliveryTarget[]> {
    const rows = await this.prisma.adConnection.findMany({
      where: { studioId, status: 'CONNECTED' },
      select: { platform: true },
    });
    return [...new Set(rows.map((r) => TARGET_BY_PLATFORM[r.platform as AdConnectionPlatform]))];
  }
}
