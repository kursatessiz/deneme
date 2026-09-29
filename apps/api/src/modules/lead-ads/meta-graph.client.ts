import { Injectable } from '@nestjs/common';
import { META_CAPI_HOST, META_GRAPH_API_VERSION, MetaLeadSchema, isTransientGraphFailure } from '@platform/shared';
import type { MetaLead } from '@platform/shared';
import { AdsHttpClient } from '../ads/ads-http-client';

/** Outcome of fetching one lead. A failure says whether a later retry can help. */
export type FetchLeadResult = { ok: true; lead: MetaLead } | { ok: false; transient: boolean; status: number; message: string };

export type PageSubscriptionResult = { ok: true; subscribed: boolean } | { ok: false; message: string };

/**
 * The Graph API calls Lead Ads needs. The only implementation that reaches
 * the network goes through the allow-listed AdsHttpClient (graph.facebook.com
 * only); tests inject FakeMetaGraphClient so nothing calls Meta.
 */
export interface MetaGraphClient {
  /** `GET /{leadgen-id}` with the connection's token (`leads_retrieval`). */
  fetchLead(accessToken: string, leadgenId: string): Promise<FetchLeadResult>;
  /** `GET /{page-id}/subscribed_apps`: whether the app receives this page's `leadgen` field. */
  checkPageSubscription(accessToken: string, pageId: string): Promise<PageSubscriptionResult>;
}

export const META_GRAPH_CLIENT = Symbol('META_GRAPH_CLIENT');

const LEAD_FIELDS = 'id,created_time,ad_id,adset_id,campaign_id,form_id,is_organic,field_data';

function errorCodeOf(body: unknown): number | null {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error?: { code?: unknown } }).error;
    if (error && typeof error.code === 'number') return error.code;
  }
  return null;
}

/** Real client. The token travels in the Authorization header, never in the URL, so it cannot end up in a log line. */
@Injectable()
export class HttpMetaGraphClient implements MetaGraphClient {
  constructor(private readonly http: AdsHttpClient) {}

  async fetchLead(accessToken: string, leadgenId: string): Promise<FetchLeadResult> {
    let res;
    try {
      res = await this.http.getJson('META', `https://${META_CAPI_HOST}/${META_GRAPH_API_VERSION}/${encodeURIComponent(leadgenId)}?fields=${LEAD_FIELDS}`, {
        authorization: `Bearer ${accessToken}`,
      });
    } catch (err) {
      // A timeout or a refused connection is worth another try.
      return { ok: false, transient: true, status: 0, message: err instanceof Error ? err.message.slice(0, 300) : 'network error' };
    }
    if (!res.ok) {
      const code = errorCodeOf(res.body);
      return { ok: false, transient: isTransientGraphFailure(res.status, code), status: res.status, message: `Graph HTTP ${res.status}${code !== null ? ` code ${code}` : ''}` };
    }
    const parsed = MetaLeadSchema.safeParse(res.body);
    if (!parsed.success) return { ok: false, transient: false, status: res.status, message: 'Graph lead response was not understood' };
    return { ok: true, lead: parsed.data };
  }

  async checkPageSubscription(accessToken: string, pageId: string): Promise<PageSubscriptionResult> {
    try {
      const res = await this.http.getJson('META', `https://${META_CAPI_HOST}/${META_GRAPH_API_VERSION}/${encodeURIComponent(pageId)}/subscribed_apps`, {
        authorization: `Bearer ${accessToken}`,
      });
      if (!res.ok) return { ok: false, message: `Graph HTTP ${res.status}` };
      const data = (res.body as { data?: { subscribed_fields?: unknown }[] } | null)?.data ?? [];
      const subscribed = data.some((app) => Array.isArray(app.subscribed_fields) && app.subscribed_fields.includes('leadgen'));
      return { ok: true, subscribed };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message.slice(0, 300) : 'network error' };
    }
  }
}
