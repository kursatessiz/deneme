import type { PartnerProvider } from '@platform/database';
import type { PartnerConnectionCredentials, PartnerWebhookEventType } from '@platform/shared';

export interface PushAvailabilityParams {
  connectionId: string;
  scheduleExternalRef: string;
  freeSpots: number;
  startTime: Date;
}

export interface PushAvailabilityResult {
  success: boolean;
  failureMessage?: string;
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Adapter every aggregator/marketplace partner (ClassPass, Urban Sports
 * Club, Wellhub/Gympass, local Turkish equivalents, ...) implements. Real
 * providers need a signed contract and API credentials we do not have yet
 * (see docs/PARTNERS.md); MOCK is the only one wired to real logic today.
 */
export interface PartnerProviderAdapter {
  readonly name: PartnerProvider;

  /** Pushes an availability change for one session to the partner. */
  pushAvailability(
    credentials: PartnerConnectionCredentials,
    params: PushAvailabilityParams,
  ): Promise<PushAvailabilityResult>;

  /**
   * Verifies an inbound webhook's HMAC-SHA256 signature (constant-time) and
   * timestamp freshness (5 minute tolerance). Replay protection by eventId
   * is handled by the caller (PartnerWebhookEvent), not the adapter.
   */
  verifyWebhookSignature(
    credentials: PartnerConnectionCredentials,
    rawBody: string,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
    now: Date,
  ): WebhookVerificationResult;
}

export interface MockSignedWebhookEvent {
  eventId: string;
  eventType: PartnerWebhookEventType;
  timestamp: string;
  externalReservationId: string;
  scheduleExternalId?: string;
  scheduleId?: string;
  guest?: { phone?: string; fullName: string; externalGuestId?: string };
  cancelledWithinPartnerPolicy?: boolean;
}
