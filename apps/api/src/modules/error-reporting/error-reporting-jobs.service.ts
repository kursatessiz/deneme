import { Injectable, Logger } from '@nestjs/common';
import { ErrorStoreService } from './error-store.service';
import { ErrorAlertsService } from './error-alerts.service';
import { SourcemapStoreService } from './sourcemap-store.service';
import { ErrorSpikeService } from './error-spike.service';
import { AlertSinkDispatcher } from './alert-sinks/alert-sink-dispatcher.service';

export interface ErrorReportingHeartbeatResult {
  purged: number;
  sourcemapsPurged: number;
  digestSent: boolean;
  bucketsPurged: number;
  /** Spike alerts created in this run (H3). */
  spikeAlerts: number;
  /** Alert sink deliveries retried in this run, and how many of them went through (H3). */
  sinkRetries: number;
  sinkRetriesSucceeded: number;
}

/**
 * Heartbeat step: the 30-day event and source map purge, the daily super admin
 * digest, spike detection and the retry of pending alert sink deliveries (H3).
 * The H3 steps are isolated: a failure in one never fails the heartbeat.
 */
@Injectable()
export class ErrorReportingJobsService {
  private readonly logger = new Logger(ErrorReportingJobsService.name);

  constructor(
    private readonly store: ErrorStoreService,
    private readonly alerts: ErrorAlertsService,
    private readonly sourcemaps: SourcemapStoreService,
    private readonly spikes: ErrorSpikeService,
    private readonly sinks: AlertSinkDispatcher,
  ) {}

  async run(now: Date): Promise<ErrorReportingHeartbeatResult> {
    const purged = await this.store.purgeExpired(now);
    const sourcemapsPurged = await this.sourcemaps.purgeExpired(now);
    const digest = await this.alerts.sendDigestIfDue(now);
    let bucketsPurged = 0;
    let spikeAlerts = 0;
    let sinkRetries = 0;
    let sinkRetriesSucceeded = 0;
    try {
      bucketsPurged = await this.store.purgeBuckets(now);
    } catch (err) {
      this.logger.warn(`Error bucket purge failed: ${err instanceof Error ? err.name : 'unknown'}`);
    }
    try {
      spikeAlerts = (await this.spikes.run(now)).alerts;
    } catch (err) {
      this.logger.warn(`Spike detection failed: ${err instanceof Error ? err.name : 'unknown'}`);
    }
    try {
      const retried = await this.sinks.retryDue(now);
      sinkRetries = retried.attempted;
      sinkRetriesSucceeded = retried.succeeded;
    } catch (err) {
      this.logger.warn(`Alert sink retry failed: ${err instanceof Error ? err.name : 'unknown'}`);
    }
    return { purged, sourcemapsPurged, digestSent: digest.sent, bucketsPurged, spikeAlerts, sinkRetries, sinkRetriesSucceeded };
  }
}
