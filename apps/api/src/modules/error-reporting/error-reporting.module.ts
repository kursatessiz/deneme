import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ErrorCaptureService } from './error-capture.service';
import { ErrorCaptureFilter } from './error-capture.filter';
import { ERROR_SINKS } from './error-sink';
import type { ErrorSink } from './error-sink';
import { StorageErrorSink } from './storage.sink';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { ALERT_SINKS } from './alert-sinks/alert-sink';
import type { AlertSink } from './alert-sinks/alert-sink';
import { AlertHttpClient } from './alert-sinks/alert-http.client';
import { AlertSinkDispatcher } from './alert-sinks/alert-sink-dispatcher.service';
import { SlackAlertSink } from './alert-sinks/slack-alert.sink';
import { WebhookAlertSink } from './alert-sinks/webhook-alert.sink';
import { ErrorAlertMailer } from './error-alert-mailer.service';
import { ErrorAlertNotifier } from './error-alert-notifier.service';
import { ErrorAlertRecordsService } from './error-alert-records.service';
import { ErrorFeedbackService } from './error-feedback.service';
import { ErrorMergeService } from './error-merge.service';
import { ErrorSettingsService } from './error-settings.service';
import { ErrorSpikeService } from './error-spike.service';
import { ErrorStudioSettingsService } from './error-studio-settings.service';
import { ErrorStoreService } from './error-store.service';
import { ErrorAlertsService } from './error-alerts.service';
import { ErrorQueryService } from './error-query.service';
import { ErrorReportingJobsService } from './error-reporting-jobs.service';
import { TelemetryRateLimiter } from './telemetry-rate-limit.service';
import { TelemetryController } from './telemetry.controller';
import {
  AdminErrorAlertsController,
  AdminErrorSettingsController,
  AdminErrorsController,
  StudioErrorsController,
} from './error-reporting.controllers';
import { SourcemapsController } from './sourcemaps.controller';
import { SourcemapStoreService } from './sourcemap-store.service';
import { SymbolicationService } from './symbolication.service';
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
    // The static `alerts` and `settings` paths are registered before the `:id` routes of AdminErrorsController.
    AdminErrorAlertsController,
    AdminErrorSettingsController,
    AdminErrorsController,
    StudioErrorsController,
    SourcemapsController,
    ...(process.env.NODE_ENV === 'test' ? [TestErrorController] : []),
  ],
  providers: [
    ErrorStoreService,
    ErrorAlertsService,
    CredentialCipher,
    ErrorSettingsService,
    ErrorStudioSettingsService,
    ErrorAlertMailer,
    ErrorAlertRecordsService,
    ErrorAlertNotifier,
    ErrorSpikeService,
    ErrorMergeService,
    ErrorFeedbackService,
    AlertHttpClient,
    WebhookAlertSink,
    SlackAlertSink,
    {
      provide: ALERT_SINKS,
      useFactory: (webhook: WebhookAlertSink, slack: SlackAlertSink): AlertSink[] => [webhook, slack],
      inject: [WebhookAlertSink, SlackAlertSink],
    },
    AlertSinkDispatcher,
    StorageErrorSink,
    SourcemapStoreService,
    SymbolicationService,
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
