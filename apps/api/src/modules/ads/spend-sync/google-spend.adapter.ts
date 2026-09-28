import { GOOGLE_ADS_API_VERSION, GOOGLE_ADS_HOST } from '@platform/shared';
import type { AdEntityLevel } from '@platform/shared';
import type { SpendRow } from './spend-row';

const RESOURCE: Record<AdEntityLevel, string> = { CAMPAIGN: 'campaign', ADSET: 'ad_group', AD: 'ad_group_ad' };
const ID_FIELD: Record<AdEntityLevel, string> = { CAMPAIGN: 'campaign.id', ADSET: 'ad_group.id', AD: 'ad_group_ad.ad.id' };
const NAME_FIELD: Record<AdEntityLevel, string> = { CAMPAIGN: 'campaign.name', ADSET: 'ad_group.name', AD: 'ad_group_ad.ad.name' };
const STATUS_FIELD: Record<AdEntityLevel, string> = { CAMPAIGN: 'campaign.status', ADSET: 'ad_group.status', AD: 'ad_group_ad.status' };
const PARENT_FIELD: Partial<Record<AdEntityLevel, string>> = { ADSET: 'campaign.id', AD: 'ad_group.id' };

export function buildGoogleSpendUrl(customerId: string): string {
  return `https://${GOOGLE_ADS_HOST}/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`;
}

export function buildGoogleSpendQuery(level: AdEntityLevel, from: string, to: string): string {
  const parent = PARENT_FIELD[level];
  const fields = [
    ID_FIELD[level],
    NAME_FIELD[level],
    STATUS_FIELD[level],
    ...(parent ? [parent] : []),
    'segments.date',
    'metrics.cost_micros',
    'metrics.impressions',
    'metrics.clicks',
  ];
  return `SELECT ${fields.join(', ')} FROM ${RESOURCE[level]} WHERE segments.date BETWEEN '${from}' AND '${to}'`;
}

interface GoogleSearchRow {
  campaign?: { id?: string; name?: string; status?: string };
  adGroup?: { id?: string; name?: string; status?: string };
  adGroupAd?: { ad?: { id?: string; name?: string }; status?: string };
  segments?: { date?: string };
  metrics?: { costMicros?: string; impressions?: string; clicks?: string };
}

/** Google Ads reports cost in micros of the account currency (1,000,000 micros = 1 unit). */
export function parseGoogleSpendResponse(level: AdEntityLevel, currency: string, body: unknown): SpendRow[] {
  const rows = (body as { results?: GoogleSearchRow[] } | null)?.results ?? [];
  const out: SpendRow[] = [];
  for (const row of rows) {
    const externalId =
      level === 'CAMPAIGN' ? row.campaign?.id : level === 'ADSET' ? row.adGroup?.id : row.adGroupAd?.ad?.id;
    const name = level === 'CAMPAIGN' ? row.campaign?.name : level === 'ADSET' ? row.adGroup?.name : row.adGroupAd?.ad?.name;
    const status = level === 'CAMPAIGN' ? row.campaign?.status : level === 'ADSET' ? row.adGroup?.status : row.adGroupAd?.status;
    const date = row.segments?.date;
    if (!externalId || !name || !date) continue;
    const parentExternalId = level === 'ADSET' ? (row.campaign?.id ?? null) : level === 'AD' ? (row.adGroup?.id ?? null) : null;
    const micros = Number(row.metrics?.costMicros ?? 0);
    out.push({
      level,
      externalId,
      name,
      status: status ?? 'UNKNOWN',
      parentExternalId,
      date,
      spendAmount: (micros / 1_000_000).toFixed(4),
      currency,
      impressions: Number(row.metrics?.impressions ?? 0),
      clicks: Number(row.metrics?.clicks ?? 0),
    });
  }
  return out;
}
