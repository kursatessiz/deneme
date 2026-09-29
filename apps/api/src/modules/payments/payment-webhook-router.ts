import { Injectable } from '@nestjs/common';
import type { PaymentProvider } from '@platform/database';
import type { WebhookVerificationResult } from './providers/payment-provider.interface';

export interface RoutedWebhookResult {
  handled: boolean;
  alreadyProcessed?: boolean;
  reason?: string;
}

/**
 * Returns null when the provider reference is not one of the handler's
 * own records, so the next handler (or the "unknown reference" answer)
 * applies.
 */
export type ProviderWebhookHandler = (provider: PaymentProvider, verification: WebhookVerificationResult) => Promise<RoutedWebhookResult | null>;

/**
 * Lets modules that charge through the same payment adapters (G5c-1
 * platform billing) receive their verified webhooks on the existing
 * /payments/webhook/:provider URL without PaymentsModule importing them:
 * PaymentsService.handleWebhook verifies the signature once and, when the
 * reference is not a tenant Payment, offers it to the registered handlers.
 */
@Injectable()
export class PaymentWebhookRouter {
  private readonly handlers: ProviderWebhookHandler[] = [];

  register(handler: ProviderWebhookHandler): void {
    this.handlers.push(handler);
  }

  async route(provider: PaymentProvider, verification: WebhookVerificationResult): Promise<RoutedWebhookResult | null> {
    for (const handler of this.handlers) {
      const result = await handler(provider, verification);
      if (result) return result;
    }
    return null;
  }
}
