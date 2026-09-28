import { buildGoogleSpendQuery, buildGoogleSpendUrl, parseGoogleSpendResponse } from './google-spend.adapter';
import { buildMetaInsightsUrl, parseMetaInsightsResponse } from './meta-spend.adapter';
import { buildTikTokSpendUrl, parseTikTokSpendResponse } from './tiktok-spend.adapter';
import { defaultSyncRange, isoDate } from './spend-row';

describe('Meta spend adapter', () => {
  it('builds an Insights URL per level with the account id and date range', () => {
    const url = buildMetaInsightsUrl('act_123', 'ADSET', '2026-09-01', '2026-09-30');
    expect(url).toContain('act_123/insights');
    expect(url).toContain('level=adset');
    expect(url).toContain('campaign_id');
  });

  it('parses insight rows into platform-neutral spend rows, keyed on external id', () => {
    const body = {
      data: [
        { campaign_id: 'c1', campaign_name: 'tr_tr_pilates_lead_202609', spend: '150.50', impressions: '1000', clicks: '20', date_start: '2026-09-27' },
      ],
    };
    const rows = parseMetaInsightsResponse('CAMPAIGN', 'TRY', body);
    expect(rows).toEqual([
      { level: 'CAMPAIGN', externalId: 'c1', name: 'tr_tr_pilates_lead_202609', status: 'ACTIVE', parentExternalId: null, date: '2026-09-27', spendAmount: '150.50', currency: 'TRY', impressions: 1000, clicks: 20 },
    ]);
  });

  it('sets parentExternalId for ad set and ad level rows', () => {
    const adsetRows = parseMetaInsightsResponse('ADSET', 'TRY', {
      data: [{ campaign_id: 'c1', adset_id: 'as1', adset_name: 'lookalike1pct_feed_freetrial', spend: '10', impressions: '5', clicks: '1', date_start: '2026-09-27' }],
    });
    expect(adsetRows[0].parentExternalId).toBe('c1');
  });
});

describe('Google Ads spend adapter', () => {
  it('builds a GAQL query per level with the date range', () => {
    const query = buildGoogleSpendQuery('CAMPAIGN', '2026-09-01', '2026-09-30');
    expect(query).toContain('FROM campaign');
    expect(query).toContain("segments.date BETWEEN '2026-09-01' AND '2026-09-30'");
    expect(buildGoogleSpendUrl('1234567890')).toContain('customers/1234567890/googleAds:search');
  });

  it('converts cost_micros to a decimal spend amount', () => {
    const rows = parseGoogleSpendResponse('CAMPAIGN', 'TRY', {
      results: [
        {
          campaign: { id: 'c1', name: 'tr_tr_pilates_lead_202609', status: 'ENABLED' },
          segments: { date: '2026-09-27' },
          metrics: { costMicros: '150500000', impressions: '1000', clicks: '20' },
        },
      ],
    });
    expect(rows).toEqual([
      { level: 'CAMPAIGN', externalId: 'c1', name: 'tr_tr_pilates_lead_202609', status: 'ENABLED', parentExternalId: null, date: '2026-09-27', spendAmount: '150.5000', currency: 'TRY', impressions: 1000, clicks: 20 },
    ]);
  });
});

describe('TikTok spend adapter', () => {
  it('builds a report URL with data level and dimensions per level', () => {
    const url = buildTikTokSpendUrl('adv_1', 'AD', '2026-09-27', '2026-09-27');
    expect(url).toContain('data_level=AUCTION_AD');
    expect(url).toContain('advertiser_id=adv_1');
  });

  it('parses report rows keyed on the level dimension', () => {
    const rows = parseTikTokSpendResponse('CAMPAIGN', 'TRY', '2026-09-27', {
      data: { list: [{ dimensions: { campaign_id: 'c1' }, metrics: { campaign_name: 'tr_tr_pilates_lead_202609', spend: '80', impressions: '400', clicks: '8' } }] },
    });
    expect(rows).toEqual([
      { level: 'CAMPAIGN', externalId: 'c1', name: 'tr_tr_pilates_lead_202609', status: 'ACTIVE', parentExternalId: null, date: '2026-09-27', spendAmount: '80', currency: 'TRY', impressions: 400, clicks: 8 },
    ]);
  });
});

describe('defaultSyncRange', () => {
  it('spans yesterday through today', () => {
    const range = defaultSyncRange(new Date('2026-09-28T12:00:00Z'));
    expect(range).toEqual({ from: '2026-09-27', to: '2026-09-28' });
  });

  it('isoDate formats as yyyy-MM-dd', () => {
    expect(isoDate(new Date('2026-01-05T23:59:00Z'))).toBe('2026-01-05');
  });
});
