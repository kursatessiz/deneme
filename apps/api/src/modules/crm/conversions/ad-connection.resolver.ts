import { Injectable } from '@nestjs/common';
import type { ConversionDeliveryTarget } from '@platform/shared';

/**
 * Which ad platforms a tenant has connected for server-side conversion
 * delivery. G2b adds the AdAccount model and the real resolver; until then
 * no tenant has a connection, so no outbox row is ever written.
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
