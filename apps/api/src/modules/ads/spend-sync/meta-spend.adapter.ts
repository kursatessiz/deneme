import { META_CAPI_HOST, META_GRAPH_API_VERSION } from '@platform/shared';
import type { AdEntityLevel } from '@platform/shared';
import type { SpendRow } from './spend-row';

const LEVEL_FIELDS: Record<AdEntityLevel, string> = {
  CAMPAIGN: 'campaign_id,campaign_name',
  ADSET: 'campaign_id,adset_id,adset_name',
  AD: 'adset_id,ad_id,ad_name',
};
const META_LEVEL: Record<AdEntityLevel, string> = { CAMPAIGN: 'campaign', ADSET: 'adset', AD: 'ad' };

export function buildMetaInsightsUrl(externalAccountId: string, level: AdEntityLevel, from: string, to: string): string {
  const fields = `${LEVEL_FIELDS[level]},spend,impressions,clicks`;
  const timeRange = encodeURIComponent(JSON.stringify({ since: from, until: to }));
  return `https://${META_CAPI_HOST}/${META_GRAPH_API_VERSION}/${externalAccountId}/insights?level=${META_LEVEL[level]}&time_range=${timeRange}&time_increment=1&fields=${fields}`;
}

interface MetaInsightRow {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  date_start?: string;
}

/** Meta Insights returns amounts in the account's own currency; we ask the connection for the tenant's currency separately (Studio.currency). */
export function parseMetaInsightsResponse(level: AdEntityLevel, currency: string, body: unknown): SpendRow[] {
  const rows = (body as { data?: MetaInsightRow[] } | null)?.data ?? [];
  const out: SpendRow[] = [];
  for (const row of rows) {
    const externalId = level === 'CAMPAIGN' ? row.campaign_id : level === 'ADSET' ? row.adset_id : row.ad_id;
    const name = level === 'CAMPAIGN' ? row.campaign_name : level === 'ADSET' ? row.adset_name : row.ad_name;
    if (!externalId || !name || !row.date_start) continue;
    const parentExternalId = level === 'ADSET' ? (row.campaign_id ?? null) : level === 'AD' ? (row.adset_id ?? null) : null;
    out.push({
      level,
      externalId,
      name,
      status: 'ACTIVE',
      parentExternalId,
      date: row.date_start,
      spendAmount: row.spend ?? '0',
      currency,
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
    });
  }
  return out;
}
