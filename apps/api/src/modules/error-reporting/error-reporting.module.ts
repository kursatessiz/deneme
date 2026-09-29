import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ErrorCaptureService } from './error-capture.service';
import { ErrorCaptureFilter } from './error-capture.filter';
import { ERROR_SINKS } from './error-sink';
import type { ErrorSink } from './error-sink';
import { StorageErrorSink } from './storage.sink';
import { ErrorStoreService } from './error-store.service';
import { ErrorAlertsService } from './error-alerts.service';
import { ErrorQueryService } from './error-query.service';
import { ErrorReportingJobsService } from './error-reporting-jobs.service';
import { TelemetryRateLimiter } from './telemetry-rate-limit.service';
import { TelemetryController } from './telemetry.controller';
import { AdminErrorsController, StudioErrorsController } from './error-reporting.controllers';
import { TestErrorController } from './test-error.controller';
import { RequestIdMiddleware } from './request-id.middleware';

/**
 * H1 error capture and reporting (docs/HATA_RAPORLAMA.md): request ids,
 * the global 5xx filter, client ingest, storage, alerts and the admin and
 * tenant views. Global so the scheduler, webhooks and any module can
 * inject ErrorCaptureService without an import cycle. The failing test
 * routes exist only when NODE_ENV=test.
 */
@Global()
@Module({
  imports: [AuthModule, MessagingModule],
  controllers: [
    TelemetryController,
    AdminErrorsController,
    StudioErrorsController,
    ...(process.env.NODE_ENV === 'test' ? [TestErrorController] : []),
  ],
  providers: [
    ErrorStoreService,
    ErrorAlertsService,
    StorageErrorSink,
    { provide: ERROR_SINKS, useFactory: (storage: StorageErrorSink): ErrorSink[] => [storage], inject: [StorageErrorSink] },
    ErrorCaptureService,
    ErrorQueryService,
    ErrorReportingJobsService,
    TelemetryRateLimiter,
    { provide: APP_FILTER, useClass: ErrorCaptureFilter },
  ],
  exports: [ErrorCaptureService, ErrorReportingJobsService],
})
export class ErrorReportingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
