import { Injectable } from '@nestjs/common';
import type { ConsentChannelName } from '@platform/shared';
import { ConsentService } from '../notifications/consent/consent.service';

/**
 * The TR compliance region's consent registry: İYS (İleti Yönetim
 * Sistemi), via the existing ConsentService/IysClientAdapter -- kept in
 * place under notifications/consent (its controller's routes and behaviour
 * are unchanged, per docs/BUYUME_VE_GLOBAL_MIMARI.md section 2 and the G1a
 * scope) and referenced here as this region's consent adapter, so
 * `ComplianceService.canSend` and its callers have one place to resolve
 * "is this recipient opted in for this channel" without caring which
 * region's registry backs the answer.
 */
@Injectable()
export class TrConsentRegistryAdapter {
  constructor(private readonly consents: ConsentService) {}

  isGranted(studioId: string, userId: string, channel: ConsentChannelName): Promise<boolean> {
    return this.consents.isGranted(studioId, userId, channel);
  }
}
