import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateRequest } from 'twilio/lib/webhooks/webhooks';
import type { ChannelSendRequest, ChannelSendResult, MessageChannel } from './message-channel.interface';

/**
 * Twilio REST SMS adapter: the platform's global default SMS provider (see
 * docs/BUYUME_VE_GLOBAL_MIMARI.md section 2.2). Sends for real only when
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are
 * configured; otherwise behaves like MOCK SMS (logs and reports success),
 * exactly like the Netgsm and Ileti Merkezi adapters.
 */
@Injectable()
export class SmsTwilioAdapter implements MessageChannel {
  readonly name = 'SMS' as const;
  private readonly logger = new Logger(SmsTwilioAdapter.name);

  constructor(private readonly config: ConfigService) {}

  private get isConfigured(): boolean {
    return (
      !!this.config.get<string>('TWILIO_ACCOUNT_SID') &&
      !!this.config.get<string>('TWILIO_AUTH_TOKEN') &&
      !!this.config.get<string>('TWILIO_FROM_NUMBER')
    );
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    if (!this.isConfigured) {
      this.logger.log(`[MOCK SMS/Twilio] Simulated SMS sent to ${request.phone}`);
      return { success: true, providerMessageId: `mock-twilio-${Date.now()}` };
    }

    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID')!;
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN')!;
    const from = request.senderName ?? this.config.get<string>('TWILIO_FROM_NUMBER')!;

    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        },
        body: new URLSearchParams({ To: request.phone, From: from, Body: request.body }),
      });
      const payload = (await response.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
      if (!response.ok) {
        this.logger.error(`Twilio send failed: ${payload.message ?? response.status}`);
        return { success: false, errorMessage: payload.message ?? `HTTP ${response.status}` };
      }
      return { success: true, providerMessageId: payload.sid };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Twilio send threw: ${message}`);
      return { success: false, errorMessage: message };
    }
  }

  /** Twilio account balance (their Balance API). MOCK reports a fixed, healthy balance, like the other adapters. */
  async getBalance(): Promise<{ credits: number | null; errorMessage?: string }> {
    if (!this.isConfigured) {
      return { credits: 10_000 };
    }
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID')!;
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN')!;
    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Balance.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
      });
      const payload = (await response.json().catch(() => ({}))) as { balance?: string; message?: string };
      const credits = Number(payload.balance);
      if (!response.ok || Number.isNaN(credits)) {
        return { credits: null, errorMessage: payload.message ?? `HTTP ${response.status}` };
      }
      return { credits };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Twilio balance query threw: ${message}`);
      return { credits: null, errorMessage: message };
    }
  }

  /**
   * Verifies a Twilio delivery-status webhook's `X-Twilio-Signature`
   * against the full callback URL and posted form params (Twilio's
   * documented HMAC-SHA1 scheme). Returns false (never throws) when
   * unconfigured or the signature does not match.
   */
  verifyStatusWebhook(url: string, params: Record<string, string>, signature: string | undefined): boolean {
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    if (!authToken || !signature) return false;
    try {
      return validateRequest(authToken, signature, url, params);
    } catch {
      return false;
    }
  }
}
