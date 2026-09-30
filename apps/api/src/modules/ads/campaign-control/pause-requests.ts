import { GOOGLE_ADS_API_VERSION, GOOGLE_ADS_HOST, META_CAPI_HOST, META_GRAPH_API_VERSION } from '@platform/shared';

/**
 * Request builders of the pause capability (M5). Pausing is the only write
 * the platform makes to an ad platform: it can only reduce spend, so it needs
 * no approval (docs/PAZARLAMA_MODULU.md). Pure functions, so the adapters are
 * unit tested without a network; the hosts stay on the fixed allow-list of
 * AdsHttpClient.
 */

const DIGITS = /^\d{1,30}$/;

export class InvalidAdIdError extends Error {}

function digits(value: string, what: string): string {
  const cleaned = value.replace(/-/g, '');
  if (!DIGITS.test(cleaned)) throw new InvalidAdIdError(`${what} numeric olmalı`);
  return cleaned;
}

export interface MetaPauseRequest {
  url: string;
  /** The access token travels in the body, never in the URL. */
  form: Record<string, string>;
}

/** Meta Graph: POST /{campaign-id} with status=PAUSED. */
export function buildMetaPauseRequest(campaignId: string, accessToken: string): MetaPauseRequest {
  return {
    url: `https://${META_CAPI_HOST}/${META_GRAPH_API_VERSION}/${digits(campaignId, 'Meta kampanya kimliği')}`,
    form: { status: 'PAUSED', access_token: accessToken },
  };
}

export interface GooglePauseRequest {
  url: string;
  body: { operations: Array<{ updateMask: 'status'; update: { resourceName: string; status: 'PAUSED' } }> };
}

/** Google Ads: campaigns:mutate with an update of `status` to PAUSED. */
export function buildGooglePauseRequest(customerId: string, campaignId: string): GooglePauseRequest {
  const customer = digits(customerId, 'Google müşteri kimliği');
  const campaign = digits(campaignId, 'Google kampanya kimliği');
  return {
    url: `https://${GOOGLE_ADS_HOST}/${GOOGLE_ADS_API_VERSION}/customers/${customer}/campaigns:mutate`,
    body: { operations: [{ updateMask: 'status', update: { resourceName: `customers/${customer}/campaigns/${campaign}`, status: 'PAUSED' } }] },
  };
}
