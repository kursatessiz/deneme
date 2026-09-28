import { Body, Controller, Headers, HttpCode, Logger, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { normalizePhone } from '@platform/shared';
import type { ConversationAttachmentDTO } from '@platform/shared';
import { SmsTwilioAdapter } from '../channels/sms-twilio.adapter';
import { DeliveryStatusService } from './delivery-status.service';
import type { DeliveryUpdateKind } from './delivery-status.service';
import { InboundService } from '../inbox/inbound.service';

const TWILIO_STATUS_MAP: Record<string, DeliveryUpdateKind | undefined> = {
  delivered: 'DELIVERED',
  sent: 'SENT',
  undelivered: 'FAILED',
  failed: 'FAILED',
  read: 'READ',
};

/** Twilio error codes meaning the number cannot receive SMS at all (unreachable, unknown, landline). */
const PERMANENT_ERROR_CODES = new Set(['30003', '30005', '30006']);

/**
 * Twilio webhooks: delivery status callbacks and inbound SMS. No JWT:
 * Twilio authenticates with its own X-Twilio-Signature scheme, verified
 * against the exact public callback URL (PUBLIC_API_URL + path) and the
 * posted form params before anything is trusted.
 */
@Controller('notifications/webhook/twilio')
export class TwilioWebhookController {
  private readonly logger = new Logger(TwilioWebhookController.name);

  constructor(
    private readonly twilio: SmsTwilioAdapter,
    private readonly config: ConfigService,
    private readonly delivery: DeliveryStatusService,
    private readonly inbound: InboundService,
  ) {}

  private callbackUrl(req: Request): string {
    const base = this.config.get<string>('PUBLIC_API_URL') ?? `${req.protocol}://${req.get('host')}`;
    return `${base.replace(/\/+$/, '')}${req.originalUrl}`;
  }

  @Post('status')
  @HttpCode(200)
  async status(@Req() req: Request, @Headers('x-twilio-signature') signature: string | undefined, @Body() body: Record<string, string>) {
    if (!this.twilio.verifyStatusWebhook(this.callbackUrl(req), body, signature)) {
      this.logger.warn('Rejected Twilio status webhook: signature did not verify');
      return { verified: false };
    }
    const messageSid = body.MessageSid;
    const kind = TWILIO_STATUS_MAP[(body.MessageStatus ?? '').toLowerCase()];
    if (!messageSid || !kind) return { verified: true, updated: false };
    await this.delivery.apply({
      providerMessageId: messageSid,
      kind,
      permanent: kind === 'FAILED' && PERMANENT_ERROR_CODES.has(String(body.ErrorCode ?? '')),
      errorMessage: body.ErrorMessage ?? (body.ErrorCode ? `Twilio ${body.ErrorCode}` : null),
      detail: body.ErrorCode ? `twilio_${body.ErrorCode}` : null,
    });
    return { verified: true, updated: true };
  }

  /** Inbound SMS (the number's "A message comes in" webhook). Answers with empty TwiML: replies go through the inbox. */
  @Post('inbound')
  async inboundSms(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-twilio-signature') signature: string | undefined,
    @Body() body: Record<string, string>,
  ): Promise<void> {
    if (!this.twilio.verifyStatusWebhook(this.callbackUrl(req), body, signature)) {
      this.logger.warn('Rejected Twilio inbound webhook: signature did not verify');
      res.status(403).json({ verified: false });
      return;
    }
    const from = normalizePhone(body.From ?? '', 'US');
    if (from && body.MessageSid) {
      const attachments: ConversationAttachmentDTO[] = [];
      const count = Math.min(Number(body.NumMedia ?? 0) || 0, 10);
      for (let i = 0; i < count; i++) {
        const mimeType = body[`MediaContentType${i}`] ?? null;
        attachments.push({ kind: (mimeType ?? 'file').split('/')[0], mimeType, providerMediaId: body[`MediaUrl${i}`] ?? null, fileName: null });
      }
      await this.inbound.receive({
        channel: 'SMS',
        provider: 'TWILIO',
        from,
        to: body.To ? normalizePhone(body.To, 'US') : null,
        body: body.Body ?? '',
        providerMessageId: body.MessageSid,
        attachments,
        receivedAt: new Date(),
      });
    }
    res.status(200).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
}
