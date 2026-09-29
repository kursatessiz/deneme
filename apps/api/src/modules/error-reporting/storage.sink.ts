import { Injectable, Logger } from '@nestjs/common';
import type { ErrorEventRecord } from '@platform/shared';
import type { ErrorSink } from './error-sink';
import { ErrorStoreService } from './error-store.service';
import { ErrorAlertsService } from './error-alerts.service';

/**
 * The H1 sink: Postgres storage, then alerts. An alert failure never
 * undoes or fails the stored event.
 */
@Injectable()
export class StorageErrorSink implements ErrorSink {
  readonly name = 'storage';
  private readonly logger = new Logger(StorageErrorSink.name);

  constructor(
    private readonly store: ErrorStoreService,
    private readonly alerts: ErrorAlertsService,
  ) {}

  async write(event: ErrorEventRecord): Promise<void> {
    const recorded = await this.store.record(event);
    if (!recorded) return;
    try {
      await this.alerts.onRecorded(recorded);
    } catch (err) {
      this.logger.warn(`Error alert failed for group ${recorded.group.id}: ${err instanceof Error ? err.name : 'unknown'}`);
    }
  }
}
