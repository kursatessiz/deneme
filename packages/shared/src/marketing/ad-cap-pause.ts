import { z } from 'zod';
import type { AdConnectionPlatform } from '../growth/ads';
import { AD_CONNECTION_PLATFORMS } from '../growth/ads';

/**
 * Ad spend cap auto-pause (M5, docs/PAZARLAMA_MODULU.md). An opt-in setting
 * (`adCapAutoPause`): when the month-to-date spend of a currency passes its
 * monthly cap, the heartbeat pauses the platform tenant's active campaigns on
 * the ad platforms that spent in that currency. Pausing is the only write the
 * system makes to an ad platform (it can only reduce spend); resuming is
 * always a person's action in the ad platform.
 */

/** Platforms whose adapter can pause a campaign (TikTok has no campaign management access yet). */
export const AD_PAUSE_CAPABLE_PLATFORMS = ['META', 'GOOGLE'] as const satisfies readonly AdConnectionPlatform[];
export type AdPauseCapablePlatform = (typeof AD_PAUSE_CAPABLE_PLATFORMS)[number];

export function isAdPauseCapable(platform: string): platform is AdPauseCapablePlatform {
  return (AD_PAUSE_CAPABLE_PLATFORMS as readonly string[]).includes(platform);
}

/** PAUSED: the platform accepted the pause; FAILED: every attempt of the month failed so far (retried by the next heartbeat). */
export const AD_CAP_PAUSE_STATUSES = ['PAUSED', 'FAILED'] as const;
export type AdCapPauseStatus = (typeof AD_CAP_PAUSE_STATUSES)[number];

/** The `AdEntity.status` values that mean "delivering" per platform (the spend sync stores the platform's own word). */
const ACTIVE_ENTITY_STATUSES: Readonly<Record<AdConnectionPlatform, readonly string[]>> = {
  META: ['ACTIVE'],
  GOOGLE: ['ENABLED'],
  TIKTOK: ['ENABLE'],
};

export function isActiveAdEntityStatus(platform: string, status: string): boolean {
  if (!(AD_CONNECTION_PLATFORMS as readonly string[]).includes(platform)) return false;
  return ACTIVE_ENTITY_STATUSES[platform as AdConnectionPlatform].includes(status.toUpperCase());
}

/** The `AdEntity.status` written after a successful pause (Meta and Google both spell it PAUSED). */
export const AD_ENTITY_PAUSED_STATUS = 'PAUSED';

/** One external campaign the auto-pause paused (or could not pause), as the dashboard lists it. */
export const AdCapPauseSchema = z
  .object({
    platform: z.enum(AD_CONNECTION_PLATFORMS),
    campaignExternalId: z.string(),
    campaignName: z.string(),
    currency: z.string().length(3),
    /** yyyy-MM (UTC). */
    month: z.string().regex(/^\d{4}-\d{2}$/),
    /** Decimal text with two decimals: spend and cap at the moment of the pause. */
    spent: z.string(),
    cap: z.string(),
    status: z.enum(AD_CAP_PAUSE_STATUSES),
    attempts: z.number().int().min(1),
    lastError: z.string().nullable(),
    pausedAt: z.string().datetime().nullable(),
  })
  .strict();
export type AdCapPauseDTO = z.infer<typeof AdCapPauseSchema>;

export interface AdCapPauseCandidate {
  platform: string;
  externalId: string;
  status: string;
}

export interface AdCapPausePlan {
  /** Active campaigns on capable platforms not yet paused this month. */
  toPause: AdCapPauseCandidate[];
  /** Platforms with spend over the cap that cannot be paused through an adapter (logged and skipped). */
  unsupportedPlatforms: string[];
}

/** Stable key of one campaign within one month (one pause per campaign per month). */
export function adCapPauseKey(platform: string, externalId: string): string {
  return `${platform}:${externalId}`;
}

/**
 * Which campaigns to pause when a currency's cap is exceeded: the active ones
 * of the platforms that spent in that currency, minus the ones already paused
 * this month (`alreadyPaused` holds adCapPauseKey values). A campaign that is
 * not active (paused, removed) is never touched. Pure, so it is unit tested.
 */
export function planAdCapPauses(input: {
  platformsWithSpend: readonly string[];
  campaigns: readonly AdCapPauseCandidate[];
  alreadyPaused: ReadonlySet<string>;
}): AdCapPausePlan {
  const platforms = [...new Set(input.platformsWithSpend)].sort();
  const unsupportedPlatforms = platforms.filter((p) => !isAdPauseCapable(p));
  const capable = new Set(platforms.filter(isAdPauseCapable));
  const seen = new Set<string>();
  const toPause: AdCapPauseCandidate[] = [];
  for (const campaign of input.campaigns) {
    if (!capable.has(campaign.platform as AdPauseCapablePlatform)) continue;
    if (!isActiveAdEntityStatus(campaign.platform, campaign.status)) continue;
    const key = adCapPauseKey(campaign.platform, campaign.externalId);
    if (input.alreadyPaused.has(key) || seen.has(key)) continue;
    seen.add(key);
    toPause.push(campaign);
  }
  return { toPause, unsupportedPlatforms };
}
