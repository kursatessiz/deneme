import { z } from 'zod';

/**
 * Visitor tracking and ad attribution contracts. See
 * docs/BUYUME_VE_GLOBAL_MIMARI.md sections 3.2-3.4 and 4.
 *
 * Attribution is keyed on ad platform IDs (pw_cid / pw_asid / pw_adid),
 * never on names: names are for humans and are refreshed from the ad
 * platform APIs, so renaming an ad never breaks a report.
 */

export const AD_PLATFORMS = ['META', 'GOOGLE', 'TIKTOK', 'LINKEDIN', 'MICROSOFT', 'OTHER'] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term', 'utm_content'] as const;
/** Platform-neutral ad ids we add to every ad URL (section 4.2). */
export const AD_ID_PARAMS = ['pw_cid', 'pw_asid', 'pw_adid', 'pw_plc'] as const;
export const CLICK_ID_PARAMS = ['fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'li_fat_id', 'msclkid'] as const;

export const VISITOR_COOKIE = 'pw_vid';
export const SESSION_COOKIE = 'pw_sid';
export const VISITOR_COOKIE_MAX_AGE_DAYS = 395;
export const SESSION_IDLE_MINUTES = 30;

const param = z.string().trim().max(250);

function paramsObject<K extends string>(keys: readonly K[]) {
  const shape = Object.fromEntries(keys.map((key) => [key, param.optional()])) as {
    [P in K]: z.ZodOptional<typeof param>;
  };
  return z.object(shape).strict();
}

/** What the site sends to POST /track/touchpoint on the first request of a session. */
export const TouchpointInputSchema = z
  .object({
    visitorId: z.string().uuid(),
    sessionId: z.string().uuid(),
    landingUrl: z.string().url().max(2000),
    referrer: z.string().max(2000).optional(),
    utm: paramsObject(UTM_PARAMS),
    adIds: paramsObject(AD_ID_PARAMS),
    clickIds: paramsObject(CLICK_ID_PARAMS),
    /** Meta browser cookies, when present and consented. */
    fbp: param.optional(),
    fbc: param.optional(),
    locale: z.string().max(10).optional(),
    /** A/B page variant the visitor was assigned, if any. */
    pageVariant: z.string().max(40).optional(),
    consent: z
      .object({
        analytics: z.boolean(),
        advertising: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type TouchpointInput = z.infer<typeof TouchpointInputSchema>;

type Params = Pick<TouchpointInput, 'utm' | 'adIds' | 'clickIds'>;

/**
 * Minimal query-string reader so this module runs on web, mobile and API
 * without DOM or Node typings. Returns null for anything that is not an
 * absolute http(s) URL. The first occurrence of a key wins.
 */
function queryParams(url: string): Map<string, string> | null {
  if (!/^https?:\/\/[^\s/?#]+/i.test(url)) return null;
  const hashIndex = url.indexOf('#');
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = withoutHash.indexOf('?');
  const out = new Map<string, string>();
  if (queryIndex < 0) return out;
  for (const pair of withoutHash.slice(queryIndex + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
    const rawValue = eq >= 0 ? pair.slice(eq + 1) : '';
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
      if (!out.has(key)) out.set(key, value);
    } catch {
      // Malformed percent-encoding: skip this pair only.
    }
  }
  return out;
}

/** Reads tracking parameters from a landing URL. Unknown parameters are ignored. */
export function parseTrackingParams(url: string): Params {
  const empty: Params = { utm: {}, adIds: {}, clickIds: {} };
  const search = queryParams(url);
  if (!search) return empty;
  const pick = <K extends string>(keys: readonly K[]): Partial<Record<K, string>> => {
    const out: Partial<Record<K, string>> = {};
    for (const key of keys) {
      const value = search.get(key);
      if (value && value.trim()) out[key] = value.trim().slice(0, 250);
    }
    return out;
  };
  return { utm: pick(UTM_PARAMS), adIds: pick(AD_ID_PARAMS), clickIds: pick(CLICK_ID_PARAMS) };
}

/** Best-effort platform detection from click ids and utm_source. */
export function detectAdPlatform(params: Params): AdPlatform | null {
  const { clickIds, utm } = params;
  if (clickIds.gclid || clickIds.gbraid || clickIds.wbraid) return 'GOOGLE';
  if (clickIds.fbclid) return 'META';
  if (clickIds.ttclid) return 'TIKTOK';
  if (clickIds.li_fat_id) return 'LINKEDIN';
  if (clickIds.msclkid) return 'MICROSOFT';
  const source = (utm.utm_source ?? '').toLowerCase();
  if (['fb', 'ig', 'an', 'msg', 'facebook', 'instagram', 'meta'].includes(source)) return 'META';
  if (['google', 'youtube'].includes(source)) return 'GOOGLE';
  if (source === 'tiktok') return 'TIKTOK';
  if (source === 'linkedin') return 'LINKEDIN';
  if (['bing', 'microsoft'].includes(source)) return 'MICROSOFT';
  return null;
}

/** True when the visit came from a paid ad but without our standard parameters. */
export function isUntaggedPaidTraffic(params: Params): boolean {
  const hasClickId = Object.values(params.clickIds).some(Boolean);
  const hasAdIds = Boolean(params.adIds.pw_cid && params.adIds.pw_asid);
  return hasClickId && !hasAdIds;
}

// Naming convention (section 4.1) ----------------------------------------

export const CAMPAIGN_OBJECTIVES = ['lead', 'trial', 'signup', 'purchase', 'brand', 'retarget'] as const;
export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

/** {market}_{lang}_{sector}_{objective}_{yyyymm}, all lowercase ascii. */
export const CAMPAIGN_NAME_PATTERN = /^([a-z]{2})_([a-z]{2,3})_([a-z0-9]+)_([a-z]+)_(\d{6})$/;
const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface CampaignNameParts {
  market: string;
  language: string;
  sector: string;
  objective: CampaignObjective;
  yearMonth: string;
}

export function buildCampaignName(parts: CampaignNameParts): string {
  for (const value of [parts.market, parts.language, parts.sector]) {
    if (!SEGMENT.test(value) || value.includes('-')) throw new Error(`Geçersiz ad parçası: ${value}`);
  }
  if (!/^\d{6}$/.test(parts.yearMonth)) throw new Error('Ay yyyymm biçiminde olmalı');
  return [parts.market, parts.language, parts.sector, parts.objective, parts.yearMonth].join('_');
}

export function parseCampaignName(name: string): CampaignNameParts | null {
  const match = CAMPAIGN_NAME_PATTERN.exec(name.trim().toLowerCase());
  if (!match) return null;
  const objective = match[4] as CampaignObjective;
  if (!(CAMPAIGN_OBJECTIVES as readonly string[]).includes(objective)) return null;
  return { market: match[1], language: match[2], sector: match[3], objective, yearMonth: match[5] };
}

/** Parameter templates pasted into the ad platforms (section 4.2). */
export const AD_URL_TEMPLATES: Readonly<Record<'META' | 'GOOGLE' | 'TIKTOK', string>> = {
  META:
    'utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}' +
    '&utm_term={{adset.name}}&utm_content={{ad.name}}&pw_cid={{campaign.id}}&pw_asid={{adset.id}}&pw_adid={{ad.id}}&pw_plc={{placement}}',
  GOOGLE:
    'utm_source=google&utm_medium=cpc&utm_campaign={_campaign}&utm_id={campaignid}&utm_term={keyword}&utm_content={creative}' +
    '&pw_cid={campaignid}&pw_asid={adgroupid}&pw_adid={creative}&pw_plc={network}',
  TIKTOK:
    'utm_source=tiktok&utm_medium=paid_social&utm_campaign=__CAMPAIGN_NAME__&utm_id=__CAMPAIGN_ID__&utm_term=__AID_NAME__' +
    '&utm_content=__CID_NAME__&pw_cid=__CAMPAIGN_ID__&pw_asid=__AID__&pw_adid=__CID__&pw_plc=__PLACEMENT__',
};

export const ATTRIBUTION_MODELS = ['FIRST_TOUCH', 'LAST_TOUCH', 'LINEAR'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];
export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 30;
