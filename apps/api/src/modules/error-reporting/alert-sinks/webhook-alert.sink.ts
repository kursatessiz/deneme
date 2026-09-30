import { Injectable } from '@nestjs/common';
import { buildAlertWebhookPayload } from '@platform/shared';
import type { ErrorAlertNotification } from '@platform/shared';
import { buildSignatureHeader } from '../../webhooks/webhook-signature';
import { ErrorSettingsService } from '../error-settings.service';
import { AlertHttpClient } from './alert-http.client';
import { outcomeForStatus } from './alert-sink';
import type { AlertDeliveryOutcome, AlertSink } from './alert-sink';

/**
 * The generic signed webhook sink: POSTs the alert as JSON with the same
 * `X-Signature: t=<unix>,v1=<hmac-sha256 of "t.body">` header as the public
 * webhooks (docs/PUBLIC_API.md has the verification example). The URL and the
 * secret come from the encrypted super admin settings; the SSRF guard runs at
 * save time and again at delivery, pinned to the resolved address.
 */
@Injectable()
export class WebhookAlertSink implements AlertSink {
  readonly kind = 'WEBHOOK' as const;

  constructor(
    private readonly settings: ErrorSettingsService,
    private readonly http: AlertHttpClient,
  ) {}

  async isActive(): Promise<boolean> {
    return (await this.settings.getWebhookConfig()) !== null;
  }

  async deliver(notification: ErrorAlertNotification): Promise<AlertDeliveryOutcome> {
    const config = await this.settings.getWebhookConfig();
    if (!config) return { ok: false, statusCode: null, error: 'NOT_CONFIGURED', retryable: false };
    const body = JSON.stringify(buildAlertWebhookPayload(notification));
    const response = await this.http.post({
      url: config.url,
      body,
      headers: {
        'content-type': 'application/json',
        'x-signature': buildSignatureHeader(config.secret, body),
        'x-platform-event': 'error.alert',
      },
    });
    return outcomeForStatus(response.status);
  }
}
