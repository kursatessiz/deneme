import { Injectable } from '@nestjs/common';
import type { ErasureHeartbeatResult } from '@platform/shared';
import { ErasureRequestsService } from './erasure-requests.service';

/**
 * Heartbeat step of the scheduler (apps/api/src/modules/jobs): executes
 * approved erasure requests and the ones nobody handled within 30 days. Safe
 * to call repeatedly; each request is claimed by its own status transition.
 */
@Injectable()
export class ErasureJobsService {
  constructor(private readonly requests: ErasureRequestsService) {}

  run(now = new Date()): Promise<ErasureHeartbeatResult> {
    return this.requests.processDue(now);
  }
}
