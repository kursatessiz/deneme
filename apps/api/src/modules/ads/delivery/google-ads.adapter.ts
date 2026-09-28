import { GOOGLE_ADS_API_VERSION, GOOGLE_ADS_HOST, VALUE_BEARING_EVENTS } from '@platform/shared';
import { decideDeliverySkip } from './delivery-context';
import type { DeliveryContext, DeliverySkipReason } from './delivery-context';
import { formatGoogleConversionDateTime } from './google-conversion-datetime';
import { hashEmail, hashPhoneForGoogle } from './hashing';

export type GoogleConsentValue = 'GRANTED' | 'DENIED' | 'UNSPECIFIED';

/**
 * Offline click conversion (gclid/gbraid/wbraid present):
 * POST customers/{customerId}/googleAds:uploadClickConversions
 */
export interface GoogleClickConversionPayload {
  conversions: [
    {
      gclid?: string;
      gbraid?: string;
      wbraid?: string;
      conversionAction: string;
      conversionDateTime: string;
      conversionValue?: number;
      currencyCode?: string;
      orderId: string;
      consent: { adUserData: GoogleConsentValue; adPersonalization: GoogleConsentValue };
    },
  ];
  partialFailure: true;
}

/**
 * Enhanced conversions for leads (no click id): hashed identifiers only.
 * POST customers/{customerId}/googleAds:uploadClickConversions with
 * userIdentifiers in place of a click id, per Google's enhanced conversions
 * for leads spec.
 */
export interface GoogleEnhancedLeadConversionPayload {
  conversions: [
    {
      conversionAction: string;
      conversionDateTime: string;
      conversionValue?: number;
      currencyCode?: string;
      orderId: string;
      userIdentifiers: Array<{ hashedEmail?: string; hashedPhoneNumber?: string }>;
      consent: { adUserData: GoogleConsentValue; adPersonalization: GoogleConsentValue };
    },
  ];
  partialFailure: true;
}

export type GoogleAdsPayload = GoogleClickConversionPayload | GoogleEnhancedLeadConversionPayload;

export interface GoogleAdsRequest {
  url: string;
  body: GoogleAdsPayload;
  loginCustomerId: string;
}

export interface GoogleAdsBuildResult {
  skip: DeliverySkipReason | null;
  request: GoogleAdsRequest | null;
}

export function buildGoogleAdsUrl(customerId: string): string {
  return `https://${GOOGLE_ADS_HOST}/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:uploadClickConversions`;
}

export function buildGoogleAdsPayload(ctx: DeliveryContext, loginCustomerId: string): GoogleAdsBuildResult {
  const clickId = ctx.touchpoint?.gclid || ctx.touchpoint?.gbraid || ctx.touchpoint?.wbraid || null;
  const email = hashEmail(ctx.contact.email);
  const phone = hashPhoneForGoogle(ctx.contact.phone);
  const hasIdentifiers = Boolean(clickId || email || phone);
  const skip = decideDeliverySkip(ctx, hasIdentifiers);
  if (skip) return { skip, request: null };

  const conversionAction = ctx.connection.conversionActionIds[ctx.type];
  if (!conversionAction) return { skip: 'SKIPPED_NO_MATCH', request: null };

  const conversionDateTime = formatGoogleConversionDateTime(ctx.occurredAt, ctx.studioTimezone);
  const conversionActionResource = `customers/${ctx.connection.externalAccountId}/conversionActions/${conversionAction}`;
  const consent = { adUserData: 'GRANTED' as const, adPersonalization: 'GRANTED' as const };
  const valueBearing = VALUE_BEARING_EVENTS.has(ctx.type) && ctx.value;
  const valueFields = valueBearing ? { conversionValue: Number(ctx.value!.amount), currencyCode: ctx.value!.currency } : {};

  const body: GoogleAdsPayload = clickId
    ? {
        conversions: [
          {
            ...(ctx.touchpoint?.gclid ? { gclid: ctx.touchpoint.gclid } : {}),
            ...(!ctx.touchpoint?.gclid && ctx.touchpoint?.gbraid ? { gbraid: ctx.touchpoint.gbraid } : {}),
            ...(!ctx.touchpoint?.gclid && !ctx.touchpoint?.gbraid && ctx.touchpoint?.wbraid ? { wbraid: ctx.touchpoint.wbraid } : {}),
            conversionAction: conversionActionResource,
            conversionDateTime,
            orderId: ctx.eventId,
            consent,
            ...valueFields,
          },
        ],
        partialFailure: true,
      }
    : {
        conversions: [
          {
            conversionAction: conversionActionResource,
            conversionDateTime,
            orderId: ctx.eventId,
            userIdentifiers: [
              ...(email ? [{ hashedEmail: email }] : []),
              ...(phone ? [{ hashedPhoneNumber: phone }] : []),
            ],
            consent,
            ...valueFields,
          },
        ],
        partialFailure: true,
      };

  return { skip: null, request: { url: buildGoogleAdsUrl(ctx.connection.externalAccountId), body, loginCustomerId } };
}
