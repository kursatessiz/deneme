import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChannelSendRequest, ChannelSendResult, MessageChannel } from './message-channel.interface';

/**
 * Netgsm REST SMS adapter. Sends for real only when NETGSM_USER,
 * NETGSM_PASSWORD and NETGSM_HEADER are configured; otherwise behaves like
 * MOCK SMS (logs and reports success), matching the platform's previous
 * default behaviour.
 */
@Injectable()
export class SmsNetgsmAdapter implements MessageChannel {
  readonly name = 'SMS' as const;
  private readonly logger = new Logger(SmsNetgsmAdapter.name);

  constructor(private readonly config: ConfigService) {}

  private get isConfigured(): boolean {
    return (
      !!this.config.get<string>('NETGSM_USER') &&
      !!this.config.get<string>('NETGSM_PASSWORD') &&
      !!this.config.get<string>('NETGSM_HEADER')
    );
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    if (!this.isConfigured) {
      this.logger.log(`[MOCK SMS/Netgsm] Simulated SMS sent to ${request.phone}`);
      return { success: true, providerMessageId: `mock-netgsm-${Date.now()}` };
    }

    const usercode = this.config.get<string>('NETGSM_USER');
    const password = this.config.get<string>('NETGSM_PASSWORD');
    const msgheader = request.senderName ?? this.config.get<string>('NETGSM_HEADER');

    try {
      // Documented Netgsm REST send API.
      const response = await fetch('https://api.netgsm.com.tr/sms/send/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usercode,
          password,
          gsmno: request.phone,
          message: request.body,
          msgheader,
        }),
      });
      const text = await response.text();
      // Netgsm returns "00 <jobid>" on success, an error code otherwise.
      if (!response.ok || !/^00\b/.test(text.trim())) {
        this.logger.error(`Netgsm send failed: ${text}`);
        return { success: false, errorMessage: text || `HTTP ${response.status}` };
      }
      const [, jobId] = text.trim().split(' ');
      return { success: true, providerMessageId: jobId };
    } catch (err: any) {
      this.logger.error(`Netgsm send threw: ${err.message}`);
      return { success: false, errorMessage: err.message };
    }
  }

  /**
   * Remaining SMS credits on the Netgsm account. MOCK (unconfigured) always
   * reports a fixed, healthy balance so local dev and tests never alert.
   */
  async getBalance(): Promise<{ credits: number | null; errorMessage?: string }> {
    if (!this.isConfigured) {
      return { credits: 10_000 };
    }
    const usercode = this.config.get<string>('NETGSM_USER');
    const password = this.config.get<string>('NETGSM_PASSWORD');
    try {
      // Documented Netgsm balance query API.
      const response = await fetch(
        `https://api.netgsm.com.tr/balance/list/get?usercode=${encodeURIComponent(usercode!)}&password=${encodeURIComponent(password!)}`,
      );
      const text = (await response.text()).trim();
      const [creditsRaw] = text.split(' ');
      const credits = Number(creditsRaw);
      if (!response.ok || Number.isNaN(credits)) {
        this.logger.error(`Netgsm balance query failed: ${text}`);
        return { credits: null, errorMessage: text || `HTTP ${response.status}` };
      }
      return { credits };
    } catch (err: any) {
      this.logger.error(`Netgsm balance query threw: ${err.message}`);
      return { credits: null, errorMessage: err.message };
    }
  }
}
