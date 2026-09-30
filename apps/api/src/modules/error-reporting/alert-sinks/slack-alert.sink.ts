import { Injectable } from '@nestjs/common';
import { BASE_MESSAGES, ERROR_ALERT_SINK_ALLOWED_HOSTS, buildSlackAlertPayload, createTranslator, isSlackWebhookUrl } from '@platform/shared';
import type { ErrorAlertNotification } from '@platform/shared';
import { ErrorSettingsService } from '../error-settings.service';
import { AlertHttpClient } from './alert-http.client';
import { outcomeForStatus } from './alert-sink';
import type { AlertDeliveryOutcome, AlertSink } from './alert-sink';

/** Alerts go to platform staff in the platform's base language. */
const translate = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });

/**
 * The Slack incoming webhook sink. The URL is validated against the
 * hooks.slack.com allow-list (data in @platform/shared) when saved and again
 * before every send; the payload is built by buildSlackAlertPayload.
 */
@Injectable()
export class SlackAlertSink implements AlertSink {
  readonly kind = 'SLACK' as const;

  constructor(
    private readonly settings: ErrorSettingsService,
    private readonly http: AlertHttpClient,
  ) {}

  async isActive(): Promise<boolean> {
    return (await this.settings.getSlackUrl()) !== null;
  }

  async deliver(notification: ErrorAlertNotification): Promise<AlertDeliveryOutcome> {
    const url = await this.settings.getSlackUrl();
    if (!url) return { ok: false, statusCode: null, error: 'NOT_CONFIGURED', retryable: false };
    if (!isSlackWebhookUrl(url)) return { ok: false, statusCode: null, error: 'HOST_NOT_ALLOWED', retryable: false };
    const response = await this.http.post({
      url,
      body: JSON.stringify(buildSlackAlertPayload(notification, translate)),
      headers: { 'content-type': 'application/json' },
      allowedHosts: ERROR_ALERT_SINK_ALLOWED_HOSTS.SLACK,
    });
    return outcomeForStatus(response.status);
  }
}
