import { Injectable } from '@nestjs/common';
import { ErrorStoreService } from './error-store.service';
import { ErrorAlertsService } from './error-alerts.service';
import { SourcemapStoreService } from './sourcemap-store.service';

export interface ErrorReportingHeartbeatResult {
  purged: number;
  sourcemapsPurged: number;
  digestSent: boolean;
}

/** Heartbeat step: the 30-day event and source map purge and the daily super admin digest. */
@Injectable()
export class ErrorReportingJobsService {
  constructor(
    private readonly store: ErrorStoreService,
    private readonly alerts: ErrorAlertsService,
    private readonly sourcemaps: SourcemapStoreService,
  ) {}

  async run(now: Date): Promise<ErrorReportingHeartbeatResult> {
    const purged = await this.store.purgeExpired(now);
    const sourcemapsPurged = await this.sourcemaps.purgeExpired(now);
    const digest = await this.alerts.sendDigestIfDue(now);
    return { purged, sourcemapsPurged, digestSent: digest.sent };
  }
}
