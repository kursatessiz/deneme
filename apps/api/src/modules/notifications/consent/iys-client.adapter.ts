import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IysClient, IysSyncRequest, IysSyncResult } from './iys-client.interface';

/**
 * Talks to the real İYS API once IYS_BRAND_CODE and IYS_API_KEY are
 * configured; until then it behaves like a MOCK client (logs and reports
 * success), same shape as the SMS/WhatsApp adapters.
 *
 * The real endpoint and payload shape depend on the brand's İYS integration
 * type (API or file-based); this is a skeleton for the API path
 * (https://iys.org.tr) to be filled in once the owner provides brand
 * credentials. See docs/MESSAGING.md.
 */
@Injectable()
export class IysClientAdapter implements IysClient {
  private readonly logger = new Logger(IysClientAdapter.name);

  constructor(private readonly config: ConfigService) {}

  private get isConfigured(): boolean {
    return !!this.config.get<string>('IYS_BRAND_CODE') && !!this.config.get<string>('IYS_API_KEY');
  }

  async syncConsent(request: IysSyncRequest): Promise<IysSyncResult> {
    if (!this.isConfigured) {
      this.logger.log(`[MOCK IYS] ${request.type} ${request.channel} for ${request.recipient}`);
      return { success: true, transactionId: `mock-iys-${Date.now()}` };
    }

    const brandCode = this.config.get<string>('IYS_BRAND_CODE');
    const apiKey = this.config.get<string>('IYS_API_KEY');

    try {
      // Skeleton for the real İYS REST API: exact path/payload to be
      // confirmed against the brand's onboarding documentation.
      const response = await fetch(`https://api.iys.org.tr/sps/${brandCode}/brand/consents`, {
        method: 'POST',
        headers: { Authorization: apiKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consents: [
            {
              recipient: request.recipient,
              type: request.channel,
              status: request.type,
              consentDate: request.at,
              source: 'API',
            },
          ],
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { transactionId?: string; message?: string };
      if (!response.ok) {
        return { success: false, errorMessage: payload.message ?? `HTTP ${response.status}` };
      }
      return { success: true, transactionId: payload.transactionId };
    } catch (err: any) {
      this.logger.error(`IYS sync threw: ${err.message}`);
      return { success: false, errorMessage: err.message };
    }
  }
}
