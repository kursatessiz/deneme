import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChannelSendRequest, ChannelSendResult, MessageChannel } from './message-channel.interface';

/**
 * İleti Merkezi SOAP/REST SMS adapter. Sends for real only when
 * ILETI_MERKEZI_USER, ILETI_MERKEZI_PASSWORD and ILETI_MERKEZI_SENDER are
 * configured; otherwise behaves like MOCK SMS.
 */
@Injectable()
export class SmsIletiMerkeziAdapter implements MessageChannel {
  readonly name = 'SMS' as const;
  private readonly logger = new Logger(SmsIletiMerkeziAdapter.name);

  constructor(private readonly config: ConfigService) {}

  private get isConfigured(): boolean {
    return (
      !!this.config.get<string>('ILETI_MERKEZI_USER') &&
      !!this.config.get<string>('ILETI_MERKEZI_PASSWORD') &&
      !!this.config.get<string>('ILETI_MERKEZI_SENDER')
    );
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    if (!this.isConfigured) {
      this.logger.log(`[MOCK SMS/IletiMerkezi] Simulated SMS sent to ${request.phone}`);
      return { success: true, providerMessageId: `mock-iletimerkezi-${Date.now()}` };
    }

    const username = this.config.get<string>('ILETI_MERKEZI_USER');
    const password = this.config.get<string>('ILETI_MERKEZI_PASSWORD');
    const sender = request.senderName ?? this.config.get<string>('ILETI_MERKEZI_SENDER');

    try {
      // Documented İleti Merkezi REST send API.
      const response = await fetch('https://api.iletimerkezi.com/v1/send-sms/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request: {
            authentication: { username, password },
            order: {
              sender,
              message: { text: request.body, receipents: { number: [request.phone] } },
            },
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        response?: { status?: { code?: string; message?: string }; order?: { id?: string } };
      };
      const code = payload.response?.status?.code;
      if (!response.ok || code !== '200') {
        const message = payload.response?.status?.message ?? `HTTP ${response.status}`;
        this.logger.error(`İleti Merkezi send failed: ${message}`);
        return { success: false, errorMessage: message };
      }
      return { success: true, providerMessageId: payload.response?.order?.id };
    } catch (err: any) {
      this.logger.error(`İleti Merkezi send threw: ${err.message}`);
      return { success: false, errorMessage: err.message };
    }
  }
}
