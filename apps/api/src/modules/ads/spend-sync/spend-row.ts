import type { AdEntityLevel } from '@platform/shared';

/** One platform-neutral spend row, produced by each platform's parser and upserted as AdEntity + AdSpendDaily. */
export interface SpendRow {
  level: AdEntityLevel;
  externalId: string;
  name: string;
  status: string;
  parentExternalId: string | null;
  date: string; // yyyy-MM-dd
  spendAmount: string; // decimal string
  currency: string;
  impressions: number;
  clicks: number;
}

/** Default sync window when none is given: yesterday through today (inclusive), account for the job running once a day. */
export function defaultSyncRange(now = new Date()): { from: string; to: string } {
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return { from: isoDate(yesterday), to: isoDate(now) };
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
