import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChannelSendRequest, ChannelSendResult, MessageChannel } from './message-channel.interface';

/**
 * Meta WhatsApp Cloud API adapter: sends approved template messages with
 * named parameters. Posts for real only when WHATSAPP_ACCESS_TOKEN and
 * WHATSAPP_PHONE_NUMBER_ID are configured; otherwise behaves like MOCK
 * (logs and reports success) so local development never needs a Meta app.
 *
 * See docs/MESSAGING.md for template approval steps.
 */
@Injectable()
export class WhatsAppCloudAdapter implements MessageChannel {
  readonly name = 'WHATSAPP' as const;
  private readonly logger = new Logger(WhatsAppCloudAdapter.name);

  constructor(private readonly config: ConfigService) {}

  private get isConfigured(): boolean {
    return !!this.config.get<string>('WHATSAPP_ACCESS_TOKEN') && !!this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    if (!request.whatsappTemplateName) {
      return { success: false, errorMessage: 'WhatsApp şablon adı belirtilmemiş' };
    }

    if (!this.isConfigured) {
      this.logger.log(`[MOCK WHATSAPP] ${request.phone} <- template "${request.whatsappTemplateName}"`);
      return { success: true, providerMessageId: `mock-wa-${Date.now()}` };
    }

    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');

    // Documented Meta Cloud API request body for a template message with
    // named parameters (https://developers.facebook.com/docs/whatsapp).
    const body = {
      messaging_product: 'whatsapp',
      to: request.phone.replace('+', ''),
      type: 'template',
      template: {
        name: request.whatsappTemplateName,
        language: { code: 'tr' },
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
      const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
      if (!response.ok) {
        const message = payload.error?.message ?? `HTTP ${response.status}`;
        this.logger.error(`WhatsApp send failed: ${message}`);
        return { success: false, errorMessage: message };
      }
      return { success: true, providerMessageId: payload.messages?.[0]?.id };
    } catch (err: any) {
      this.logger.error(`WhatsApp send threw: ${err.message}`);
      return { success: false, errorMessage: err.message };
    }
  }
}
