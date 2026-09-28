import { TIKTOK_EVENTS_API_VERSION, TIKTOK_EVENTS_HOST, VALUE_BEARING_EVENTS } from '@platform/shared';
import { decideDeliverySkip, landingUrlOf, unixSeconds } from './delivery-context';
import type { DeliveryContext, DeliverySkipReason } from './delivery-context';
import { hashEmail, hashExternalId, hashPhoneForMeta } from './hashing';

/** TikTok event names, close enough to Meta's for the events we send. */
const TIKTOK_EVENT_NAME: Record<DeliveryContext['type'], string> = {
  lead: 'SubmitForm',
  trial_booked: 'Schedule',
  trial_attended: 'StartTrial',
  purchase: 'CompletePayment',
  subscription_started: 'Subscribe',
  subscription_renewed: 'Subscribe',
  studio_signup: 'CompleteRegistration',
  studio_paid: 'CompletePayment',
};

export interface TikTokEventsPayload {
  event_source: 'web';
  event_source_id: string;
  data: [
    {
      event: string;
      event_id: string;
      event_time: number;
      user: {
        email?: string;
        phone?: string;
        external_id?: string;
      };
      page?: { url: string };
      ad?: { callback: string };
      properties?: { value: string; currency: string };
    },
  ];
}

export interface TikTokEventsRequest {
  url: string;
  body: TikTokEventsPayload;
}

export interface TikTokEventsBuildResult {
  skip: DeliverySkipReason | null;
  request: TikTokEventsRequest | null;
}

export function buildTikTokEventsUrl(): string {
  return `https://${TIKTOK_EVENTS_HOST}/open_api/${TIKTOK_EVENTS_API_VERSION}/event/track/`;
}

export function buildTikTokEventsPayload(ctx: DeliveryContext): TikTokEventsBuildResult {
  const email = hashEmail(ctx.contact.email);
  // TikTok's hashed phone follows the same E.164-digits-no-plus normalisation as Meta.
  const phone = hashPhoneForMeta(ctx.contact.phone);
  const ttclid = ctx.touchpoint?.ttclid ?? null;
  const hasIdentifiers = Boolean(email || phone || ttclid);
  const skip = decideDeliverySkip(ctx, hasIdentifiers);
  if (skip) return { skip, request: null };
  if (!ctx.connection.pixelOrDatasetId) return { skip: 'SKIPPED_NO_MATCH', request: null };

  const user: TikTokEventsPayload['data'][0]['user'] = {};
  if (email) user.email = email;
  if (phone) user.phone = phone;
  user.external_id = hashExternalId(ctx.contact.id);

  const url = landingUrlOf(ctx.touchpoint);
  const body: TikTokEventsPayload = {
    event_source: 'web',
    event_source_id: ctx.connection.pixelOrDatasetId,
    data: [
      {
        event: TIKTOK_EVENT_NAME[ctx.type],
        event_id: ctx.eventId,
        event_time: unixSeconds(ctx.occurredAt),
        user,
        ...(url ? { page: { url } } : {}),
        ...(ttclid ? { ad: { callback: ttclid } } : {}),
        ...(VALUE_BEARING_EVENTS.has(ctx.type) && ctx.value ? { properties: { value: ctx.value.amount, currency: ctx.value.currency } } : {}),
      },
    ],
  };

  return { skip: null, request: { url: buildTikTokEventsUrl(), body } };
}
