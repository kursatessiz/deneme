import type { AdConnectionPlatform, ConversionEventType } from '@platform/shared';

/**
 * Everything a delivery adapter needs to build one platform's payload for
 * one ConversionEvent, assembled by ConversionDeliveryDispatcherService from
 * the database rows. Kept adapter-agnostic (no Prisma types) so the payload
 * builders are pure functions unit tested without a database.
 */
export interface DeliveryTouchpoint {
  occurredAt: Date;
  advertisingConsent: boolean;
  landingHost: string | null;
  landingPath: string | null;
  fbp: string | null;
  fbc: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  ttclid: string | null;
}

export interface DeliveryContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  countryCode: string | null;
}

export interface DeliveryConnection {
  platform: AdConnectionPlatform;
  externalAccountId: string;
  pixelOrDatasetId: string | null;
  conversionActionIds: Partial<Record<ConversionEventType, string>>;
  isTestMode: boolean;
}

export interface DeliveryContext {
  eventId: string;
  type: ConversionEventType;
  occurredAt: Date;
  value: { amount: string; currency: string } | null;
  contact: DeliveryContact;
  /** Last touchpoint attributed to the event within the attribution window, or null (direct / expired / never tracked). */
  touchpoint: DeliveryTouchpoint | null;
  connection: DeliveryConnection;
  studioTimezone: string;
}

export type DeliverySkipReason = 'SKIPPED_NO_CONSENT' | 'SKIPPED_NO_MATCH';

/**
 * Consent and identifier-match gate shared by every adapter (section 3.3):
 * - No advertising consent recorded for this event (no touchpoint, or the
 *   touchpoint's consent.advertising was false at capture time) -> never
 *   send anything, regardless of what identifiers the contact happens to
 *   have on file.
 * - Consent given but the platform has nothing to match on (no click id and
 *   no hashable email/phone) -> nothing useful to send either.
 */
export function decideDeliverySkip(ctx: DeliveryContext, hasPlatformIdentifiers: boolean): DeliverySkipReason | null {
  if (!ctx.touchpoint?.advertisingConsent) return 'SKIPPED_NO_CONSENT';
  if (!hasPlatformIdentifiers) return 'SKIPPED_NO_MATCH';
  return null;
}

export function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function landingUrlOf(t: DeliveryTouchpoint | null): string | null {
  if (!t?.landingHost) return null;
  return `https://${t.landingHost}${t.landingPath ?? ''}`;
}
