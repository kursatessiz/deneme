import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '@platform/shared';
import { ConfigService } from '@nestjs/config';
import type { ChannelSendRequest, ChannelSendResult, MessageChannel } from './message-channel.interface';
import { verifyMetaSignature } from '../webhooks/whatsapp-signature';

const GRAPH_API = 'https://graph.facebook.com/v20.0';

/**
 * Meta WhatsApp Cloud API adapter. Sends approved template messages with
 * named parameters in the message's language, or a free-form text reply
 * inside the 24-hour customer-service window (the inbox checks the window
 * before asking for free-form). Posts for real only when
 * WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are configured;
 * otherwise behaves like MOCK (logs and reports success) so local
 * development never needs a Meta app.
 *
 * See docs/MESAJLASMA.md for template approval and webhook setup.
 */
@Injectable()
export class WhatsAppCloudAdapter implements MessageChannel {
  readonly name = 'WHATSAPP' as const;
  readonly key = 'WHATSAPP_CLOUD' as const;
  private readonly logger = new Logger(WhatsAppCloudAdapter.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('WHATSAPP_ACCESS_TOKEN') && !!this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    if (!request.freeForm && !request.whatsappTemplateName) {
      return { success: false, errorMessage: 'WhatsApp şablon adı belirtilmemiş' };
    }

    if (!this.isConfigured()) {
      const what = request.freeForm ? 'free-form text' : `template "${request.whatsappTemplateName}"`;
      this.logger.log(`[MOCK WHATSAPP] ${maskPhone(request.phone)} <- ${what}`);
      return { success: true, providerMessageId: `mock-wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    }

    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const to = request.phone.replace('+', '');

    // Documented Meta Cloud API request bodies
    // (https://developers.facebook.com/docs/whatsapp/cloud-api/messages).
    const body = request.freeForm
      ? { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: request.body } }
      : {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: request.whatsappTemplateName,
            language: { code: request.languageCode ?? 'tr' },
            components: [
              {
                type: 'body',
                parameters: Object.entries(request.params).map(([name, value]) => ({
                  type: 'text',
                  parameter_name: name,
                  text: value,
                })),
              },
            ],
          },
        };

    try {
      const response = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await response.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
      if (!response.ok) {
        const message = payload.error?.message ?? `HTTP ${response.status}`;
        this.logger.error(`WhatsApp send failed: ${message}`);
        return { success: false, errorMessage: message };
      }
      return { success: true, providerMessageId: payload.messages?.[0]?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`WhatsApp send threw: ${message}`);
      return { success: false, errorMessage: message };
    }
  }

  /** GET subscription handshake: echo the challenge only for our own verify token. */
  verifySubscription(mode: string | undefined, token: string | undefined): boolean {
    const expected = this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    return mode === 'subscribe' && !!expected && !!token && token === expected;
  }

  /** X-Hub-Signature-256 over the exact raw body with the Meta app secret; false when unconfigured. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!secret) return false;
    return verifyMetaSignature(rawBody, signatureHeader, secret);
  }
}
