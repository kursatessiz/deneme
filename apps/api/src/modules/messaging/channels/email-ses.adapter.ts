import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { ChannelSendResult, EmailSendRequest } from './message-channel.interface';

/**
 * Amazon SES (API v2) email adapter: the platform's global email provider
 * (docs/BUYUME_VE_GLOBAL_MIMARI.md section 2.2). Sends for real when
 * SES_REGION and SES_FROM_ADDRESS are set; AWS credentials come from the
 * SDK's default provider chain (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or
 * an instance role), never from code.
 *
 * Unconfigured it simulates success outside production (MOCK), like every
 * other adapter. In production it refuses instead, exactly like the Stripe
 * adapter: a missing configuration must never look like a delivered email.
 */
@Injectable()
export class SesEmailAdapter {
  readonly key = 'SES' as const;
  private readonly logger = new Logger(SesEmailAdapter.name);
  private client: SESv2Client | null = null;
  private clientRegion: string | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('SES_REGION') && !!this.config.get<string>('SES_FROM_ADDRESS');
  }

  private getClient(region: string): SESv2Client {
    if (!this.client || this.clientRegion !== region) {
      this.client = new SESv2Client({ region });
      this.clientRegion = region;
    }
    return this.client;
  }

  async send(request: EmailSendRequest): Promise<ChannelSendResult> {
    if (!this.isConfigured()) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        this.logger.error('SES is not configured (SES_REGION, SES_FROM_ADDRESS); refusing to pretend an email was sent');
        return { success: false, notConfigured: true, errorMessage: 'E-posta sağlayıcısı yapılandırılmamış' };
      }
      this.logger.log(`[MOCK EMAIL] ${request.to} <- "${request.subject}"`);
      return { success: true, providerMessageId: `mock-ses-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    }

    const region = this.config.get<string>('SES_REGION')!;
    const fromAddress = this.config.get<string>('SES_FROM_ADDRESS')!;
    const configurationSet = this.config.get<string>('SES_CONFIGURATION_SET');

    try {
      const result = await this.getClient(region).send(
        new SendEmailCommand({
          FromEmailAddress: `${encodeDisplayName(request.fromName)} <${fromAddress}>`,
          Destination: { ToAddresses: [request.to] },
          ReplyToAddresses: request.replyTo ? [request.replyTo] : undefined,
          ConfigurationSetName: configurationSet || undefined,
          Content: {
            Simple: {
              Subject: { Data: request.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: request.html, Charset: 'UTF-8' },
                Text: { Data: request.text, Charset: 'UTF-8' },
              },
              Headers: Object.entries(request.headers).map(([Name, Value]) => ({ Name, Value })),
            },
          },
        }),
      );
      return { success: true, providerMessageId: result.MessageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`SES send failed: ${message}`);
      return { success: false, errorMessage: message };
    }
  }
}

/**
 * RFC 2047 encoded-word for a non-ASCII display name (studio names often
 * carry Turkish letters); plain ASCII names are quoted.
 */
export function encodeDisplayName(name: string): string {
  const cleaned = name.replace(/[\r\n"<>]/g, ' ').trim().slice(0, 80) || 'Studio';
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(cleaned)) return `"${cleaned}"`;
  return `=?UTF-8?B?${Buffer.from(cleaned, 'utf8').toString('base64')}?=`;
}
