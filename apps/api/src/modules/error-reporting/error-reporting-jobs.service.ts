import { Injectable } from '@nestjs/common';
import { ErrorStoreService } from './error-store.service';
import { ErrorAlertsService } from './error-alerts.service';

export interface ErrorReportingHeartbeatResult {
  purged: number;
  digestSent: boolean;
}

/** Heartbeat step: the 30-day event purge and the daily super admin digest. */
@Injectable()
export class ErrorReportingJobsService {
  constructor(
    private readonly store: ErrorStoreService,
    private readonly alerts: ErrorAlertsService,
  ) {}

  async run(now: Date): Promise<ErrorReportingHeartbeatResult> {
    const purged = await this.store.purgeExpired(now);
    const digest = await this.alerts.sendDigestIfDue(now);
    return { purged, digestSent: digest.sent };
  }
}
