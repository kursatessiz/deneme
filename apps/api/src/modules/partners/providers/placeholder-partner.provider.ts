import { ServiceUnavailableException } from '@nestjs/common';
import type { PartnerProvider } from '@platform/database';
import type { PartnerConnectionCredentials } from '@platform/shared';
import type {
  PartnerProviderAdapter,
  PushAvailabilityParams,
  PushAvailabilityResult,
  WebhookVerificationResult,
} from './partner-provider.interface';

const NOT_CONTRACTED =
  'Bu toplayıcı/pazaryeri partneri için henüz bir sözleşme ve API kimlik bilgisi yoktur. Gereken bilgiler için docs/PARTNERS.md dosyasına bakın.';

/**
 * Shared skeleton for every real aggregator/marketplace partner (ClassPass,
 * Urban Sports Club, Wellhub/Gympass and local Turkish equivalents grouped
 * under OTHER). None of these have a signed contract or real API
 * credentials yet, so every call fails with a clear, actionable message
 * instead of silently doing nothing - see docs/PARTNERS.md for exactly what
 * the owner needs to provide to go live with each one (contract, API
 * credentials, webhook URL registration).
 *
 * TODO(W20-follow-up): implement the real HTTP calls per provider once a
 * contract exists: ClassPass Partner API, Urban Sports Club Partner API,
 * Wellhub/Gympass Partner API. verifyWebhookSignature should stay
 * HMAC-based but the header names and signing scheme differ per provider
 * and must be taken from that provider's webhook documentation.
 */
export class PlaceholderPartnerProvider implements PartnerProviderAdapter {
  constructor(readonly name: PartnerProvider) {}

  pushAvailability(
    _credentials: PartnerConnectionCredentials,
    _params: PushAvailabilityParams,
  ): Promise<PushAvailabilityResult> {
    return Promise.reject(new ServiceUnavailableException(NOT_CONTRACTED));
  }

  verifyWebhookSignature(): WebhookVerificationResult {
    return { valid: false, reason: NOT_CONTRACTED };
  }
}
