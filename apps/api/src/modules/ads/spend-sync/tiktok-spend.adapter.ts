import { TIKTOK_EVENTS_HOST } from '@platform/shared';
import type { AdEntityLevel } from '@platform/shared';
import type { SpendRow } from './spend-row';

const TIKTOK_DATA_LEVEL: Record<AdEntityLevel, string> = { CAMPAIGN: 'AUCTION_CAMPAIGN', ADSET: 'AUCTION_ADGROUP', AD: 'AUCTION_AD' };
const DIMENSION: Record<AdEntityLevel, string> = { CAMPAIGN: 'campaign_id', ADSET: 'adgroup_id', AD: 'ad_id' };

export function buildTikTokSpendUrl(advertiserId: string, level: AdEntityLevel, from: string, to: string): string {
  const dimensions = encodeURIComponent(JSON.stringify([DIMENSION[level]]));
  const metrics = encodeURIComponent(JSON.stringify(['spend', 'impressions', 'clicks', 'campaign_name', 'adgroup_name', 'ad_name']));
  return (
    `https://${TIKTOK_EVENTS_HOST}/open_api/v1.3/report/integrated/get/` +
    `?advertiser_id=${encodeURIComponent(advertiserId)}&report_type=BASIC&data_level=${TIKTOK_DATA_LEVEL[level]}` +
    `&dimensions=${dimensions}&metrics=${metrics}&start_date=${from}&end_date=${to}&page_size=1000`
  );
}

interface TikTokReportRow {
  dimensions?: Record<string, string>;
  metrics?: { spend?: string; impressions?: string; clicks?: string; campaign_name?: string; adgroup_name?: string; ad_name?: string };
}

export function parseTikTokSpendResponse(level: AdEntityLevel, currency: string, date: string, body: unknown): SpendRow[] {
  const rows = (body as { data?: { list?: TikTokReportRow[] } } | null)?.data?.list ?? [];
  const out: SpendRow[] = [];
  for (const row of rows) {
    const externalId = row.dimensions?.[DIMENSION[level]];
    const name = level === 'CAMPAIGN' ? row.metrics?.campaign_name : level === 'ADSET' ? row.metrics?.adgroup_name : row.metrics?.ad_name;
    if (!externalId || !name) continue;
    out.push({
      level,
      externalId,
      name,
      status: 'ACTIVE',
      // TikTok's basic report does not return the parent id directly at
      // this level in one call; left null until a dedicated structure sync
      // call is added (spend still reports correctly, keyed on this id).
      parentExternalId: null,
      date,
      spendAmount: row.metrics?.spend ?? '0',
      currency,
      impressions: Number(row.metrics?.impressions ?? 0),
      clicks: Number(row.metrics?.clicks ?? 0),
    });
  }
  return out;
}
