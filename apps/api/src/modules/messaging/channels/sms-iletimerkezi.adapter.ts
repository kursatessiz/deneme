import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '@platform/shared';
import { ConfigService } from '@nestjs/config';
import type { ChannelSendRequest, ChannelSendResult, SmsChannelAdapter } from './message-channel.interface';

/**
 * İleti Merkezi SOAP/REST SMS adapter. Sends for real only when
 * ILETI_MERKEZI_USER, ILETI_MERKEZI_PASSWORD and ILETI_MERKEZI_SENDER are
 * configured; otherwise behaves like MOCK SMS.
 */
@Injectable()
export class SmsIletiMerkeziAdapter implements SmsChannelAdapter {
  readonly name = 'SMS' as const;
  readonly key = 'ILETI_MERKEZI' as const;
  private readonly logger = new Logger(SmsIletiMerkeziAdapter.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return (
      !!this.config.get<string>('ILETI_MERKEZI_USER') &&
      !!this.config.get<string>('ILETI_MERKEZI_PASSWORD') &&
      !!this.config.get<string>('ILETI_MERKEZI_SENDER')
    );
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    if (!this.isConfigured()) {
      this.logger.log(`[MOCK SMS/IletiMerkezi] Simulated SMS sent to ${maskPhone(request.phone)}`);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`İleti Merkezi send threw: ${message}`);
      return { success: false, errorMessage: message };
    }
  }

  /**
   * Remaining SMS credits on the İleti Merkezi account. MOCK (unconfigured)
   * always reports a fixed, healthy balance so local dev and tests never
   * alert.
   */
  async getBalance(): Promise<{ credits: number | null; errorMessage?: string }> {
    if (!this.isConfigured()) {
      return { credits: 10_000 };
    }
    const username = this.config.get<string>('ILETI_MERKEZI_USER');
    const password = this.config.get<string>('ILETI_MERKEZI_PASSWORD');
    try {
      // Documented İleti Merkezi REST balance query API.
      const response = await fetch('https://api.iletimerkezi.com/v1/get-balance/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: { authentication: { username, password } } }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        response?: { status?: { code?: string; message?: string }; balance?: { sms?: string } };
      };
      const code = payload.response?.status?.code;
      const credits = Number(payload.response?.balance?.sms);
      if (!response.ok || code !== '200' || Number.isNaN(credits)) {
        const message = payload.response?.status?.message ?? `HTTP ${response.status}`;
        this.logger.error(`İleti Merkezi balance query failed: ${message}`);
        return { credits: null, errorMessage: message };
      }
      return { credits };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`İleti Merkezi balance query threw: ${message}`);
      return { credits: null, errorMessage: message };
    }
  }
}
