import { META_CAPI_HOST, META_EVENT_NAME, META_GRAPH_API_VERSION, VALUE_BEARING_EVENTS } from '@platform/shared';
import { decideDeliverySkip, landingUrlOf, unixSeconds } from './delivery-context';
import type { DeliveryContext, DeliverySkipReason } from './delivery-context';
import { hashEmail, hashExternalId, hashName, hashPhoneForMeta } from './hashing';

/** Meta Conversions API request body for one event (Graph API, pinned version). */
export interface MetaCapiPayload {
  data: [
    {
      event_name: string;
      event_time: number;
      event_id: string;
      action_source: 'website';
      event_source_url?: string;
      user_data: {
        em?: string[];
        ph?: string[];
        fn?: string[];
        ln?: string[];
        external_id?: string[];
        fbp?: string;
        fbc?: string;
        client_user_agent?: string;
      };
      custom_data?: { value: string; currency: string };
    },
  ];
  test_event_code?: string;
}

export interface MetaCapiRequest {
  url: string;
  body: MetaCapiPayload;
}

export interface MetaCapiBuildResult {
  skip: DeliverySkipReason | null;
  request: MetaCapiRequest | null;
}

/** Access token is appended as a query parameter by the caller right before sending; it is never part of this pure payload. */
export function buildMetaCapiUrl(pixelId: string): string {
  return `https://${META_CAPI_HOST}/${META_GRAPH_API_VERSION}/${pixelId}/events`;
}

export function buildMetaCapiPayload(ctx: DeliveryContext, testEventCode: string | undefined): MetaCapiBuildResult {
  const em = hashEmail(ctx.contact.email);
  const ph = hashPhoneForMeta(ctx.contact.phone);
  const hasFbIds = Boolean(ctx.touchpoint?.fbc || ctx.touchpoint?.fbp);
  const hasIdentifiers = Boolean(em || ph || hasFbIds);
  const skip = decideDeliverySkip(ctx, hasIdentifiers);
  if (skip) return { skip, request: null };
  if (!ctx.connection.pixelOrDatasetId) return { skip: 'SKIPPED_NO_MATCH', request: null };

  const userData: MetaCapiPayload['data'][0]['user_data'] = {};
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  const fn = hashName(ctx.contact.firstName);
  const ln = hashName(ctx.contact.lastName);
  if (fn) userData.fn = [fn];
  if (ln) userData.ln = [ln];
  userData.external_id = [hashExternalId(ctx.contact.id)];
  if (ctx.touchpoint?.fbp) userData.fbp = ctx.touchpoint.fbp;
  if (ctx.touchpoint?.fbc) userData.fbc = ctx.touchpoint.fbc;

  const sourceUrl = landingUrlOf(ctx.touchpoint);
  const body: MetaCapiPayload = {
    data: [
      {
        event_name: META_EVENT_NAME[ctx.type],
        event_time: unixSeconds(ctx.occurredAt),
        event_id: ctx.eventId,
        action_source: 'website',
        ...(sourceUrl ? { event_source_url: sourceUrl } : {}),
        user_data: userData,
        ...(VALUE_BEARING_EVENTS.has(ctx.type) && ctx.value ? { custom_data: { value: ctx.value.amount, currency: ctx.value.currency } } : {}),
      },
    ],
    ...(ctx.connection.isTestMode && testEventCode ? { test_event_code: testEventCode } : {}),
  };

  return { skip: null, request: { url: buildMetaCapiUrl(ctx.connection.pixelOrDatasetId), body } };
}
