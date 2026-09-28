import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, Inject, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryStatusService } from './delivery-status.service';
import { SNS_CERT_FETCHER, SnsVerifier, isTrustedSnsUrl, parseSnsEnvelope } from './sns-verifier';
import type { SnsCertFetcher } from './sns-verifier';

interface SesEvent {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string };
  bounce?: { bounceType?: string; bounceSubType?: string; timestamp?: string };
  complaint?: { complaintFeedbackType?: string; timestamp?: string };
  delivery?: { timestamp?: string };
}

/**
 * Amazon SES delivery events through an SNS topic (bounce, complaint,
 * delivery, reject). Every message's SNS signature is verified before it is
 * trusted; SubscriptionConfirmation is confirmed only for an AWS SNS URL.
 * SES_SNS_TOPIC_ARNS (comma separated), when set, limits the accepted topics.
 */
@Controller('messaging/webhook/ses')
export class SesWebhookController {
  private readonly logger = new Logger(SesWebhookController.name);
  private readonly verifier: SnsVerifier;

  constructor(
    private readonly delivery: DeliveryStatusService,
    private readonly config: ConfigService,
    @Inject(SNS_CERT_FETCHER) fetcher: SnsCertFetcher,
  ) {
    this.verifier = new SnsVerifier(fetcher);
  }

  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown): Promise<{ ok: true; type: string }> {
    const envelope = parseSnsEnvelope(body);
    if (!envelope) throw new BadRequestException('Geçersiz SNS iletisi');
    const allowed = (this.config.get<string>('SES_SNS_TOPIC_ARNS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(envelope.TopicArn)) throw new ForbiddenException();
    if (!(await this.verifier.verify(envelope))) {
      this.logger.warn('Rejected SNS message: signature did not verify');
      throw new ForbiddenException();
    }

    if (envelope.Type === 'SubscriptionConfirmation') {
      if (envelope.SubscribeURL && isTrustedSnsUrl(envelope.SubscribeURL, false)) {
        await fetch(envelope.SubscribeURL, { signal: AbortSignal.timeout(5000), redirect: 'error' }).catch((err: Error) =>
          this.logger.error(`SNS subscription confirmation failed: ${err.message}`),
        );
      }
      return { ok: true, type: envelope.Type };
    }
    if (envelope.Type !== 'Notification') return { ok: true, type: envelope.Type };

    let event: SesEvent;
    try {
      event = JSON.parse(envelope.Message) as SesEvent;
    } catch {
      return { ok: true, type: 'Ignored' };
    }
    const messageId = event.mail?.messageId;
    const type = event.eventType ?? event.notificationType ?? '';
    if (!messageId) return { ok: true, type: 'Ignored' };

    switch (type) {
      case 'Bounce': {
        const permanent = event.bounce?.bounceType === 'Permanent';
        await this.delivery.apply({
          providerMessageId: messageId,
          kind: 'BOUNCED',
          permanent,
          detail: `${event.bounce?.bounceType ?? ''}/${event.bounce?.bounceSubType ?? ''}`,
          errorMessage: `SES bounce ${event.bounce?.bounceType ?? ''}/${event.bounce?.bounceSubType ?? ''}`,
          occurredAt: event.bounce?.timestamp ? new Date(event.bounce.timestamp) : undefined,
        });
        break;
      }
      case 'Complaint':
        await this.delivery.apply({
          providerMessageId: messageId,
          kind: 'COMPLAINED',
          detail: event.complaint?.complaintFeedbackType ?? null,
          occurredAt: event.complaint?.timestamp ? new Date(event.complaint.timestamp) : undefined,
        });
        break;
      case 'Delivery':
        await this.delivery.apply({
          providerMessageId: messageId,
          kind: 'DELIVERED',
          occurredAt: event.delivery?.timestamp ? new Date(event.delivery.timestamp) : undefined,
        });
        break;
      case 'Reject':
      case 'Rendering Failure':
        await this.delivery.apply({ providerMessageId: messageId, kind: 'FAILED', errorMessage: `SES ${type}` });
        break;
      default:
        break;
    }
    return { ok: true, type };
  }
}
