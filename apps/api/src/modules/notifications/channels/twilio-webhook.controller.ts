import { Body, Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NotificationStatus } from '@platform/database';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsTwilioAdapter } from './sms-twilio.adapter';

const TWILIO_STATUS_MAP: Record<string, NotificationStatus | undefined> = {
  delivered: NotificationStatus.SENT,
  sent: NotificationStatus.SENT,
  undelivered: NotificationStatus.FAILED,
  failed: NotificationStatus.FAILED,
};

/**
 * Twilio's delivery status callback (configured on the Messaging Service /
 * phone number as the status callback URL). No JWT: Twilio authenticates
 * with its own X-Twilio-Signature scheme, verified against the exact
 * callback URL and posted form params before anything is trusted.
 */
@Controller('notifications/webhook/twilio')
export class TwilioWebhookController {
  private readonly logger = new Logger(TwilioWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly twilio: SmsTwilioAdapter,
  ) {}

  @Post('status')
  @HttpCode(200)
  async status(
    @Req() req: Request,
    @Headers('x-twilio-signature') signature: string | undefined,
    @Body() body: Record<string, string>,
  ) {
    const publicApiUrl = process.env.PUBLIC_API_URL ?? `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${publicApiUrl}${req.originalUrl}`;
    if (!this.twilio.verifyStatusWebhook(callbackUrl, body, signature)) {
      this.logger.warn('Rejected Twilio status webhook: signature did not verify');
      return { verified: false };
    }

    const messageSid = body.MessageSid;
    const status = TWILIO_STATUS_MAP[(body.MessageStatus ?? '').toLowerCase()];
    if (!messageSid || !status) return { verified: true, updated: false };

    await this.prisma.notificationLog.updateMany({
      where: { providerMessageId: messageSid },
      data: { status, errorMessage: body.ErrorMessage ?? undefined },
    });
    return { verified: true, updated: true };
  }
}
