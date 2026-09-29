/**
 * Browser ad pixels (G2b, docs/BUYUME_VE_GLOBAL_MIMARI.md 3.3). Loaded only
 * when the tenant (or the platform tenant) has an active ad connection AND
 * the visitor granted advertising consent -- both are checked by the
 * caller (TrackingProvider) before any function here runs. Never loaded on
 * authenticated dashboard pages: this module is only imported from the
 * public tracking tree.
 */

import { publicApiBaseUrl } from '@/lib/public-api-url';

export interface AdsPixelConfig {
  meta: { pixelId: string } | null;
  google: { conversionId: string } | null;
  tiktok: { pixelCode: string } | null;
}

const EMPTY_CONFIG: AdsPixelConfig = { meta: null, google: null, tiktok: null };

/** Public, unauthenticated: which pixels this tenant has active. No secrets in the response. */
export async function fetchAdsPixelConfig(studioSlug: string): Promise<AdsPixelConfig> {
  try {
    const res = await fetch(`${publicApiBaseUrl()}/public/studios/${encodeURIComponent(studioSlug)}/ads/pixels`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return EMPTY_CONFIG;
    return (await res.json()) as AdsPixelConfig;
  } catch {
    return EMPTY_CONFIG;
  }
}

type Fbq = ((...args: unknown[]) => void) & { queue: unknown[]; loaded: boolean };
type WindowWithFbq = Window & { fbq?: Fbq; _fbq?: Fbq };
type WindowWithTtq = Window & {
  ttq?: {
    load: (id: string) => void;
    page: () => void;
    track: (event: string, props?: Record<string, unknown>) => void;
    revokeConsent?: () => void;
  };
};
type Gtag = (...args: unknown[]) => void;
type WindowWithGtag = Window & { dataLayer?: unknown[]; gtag?: Gtag };

let metaLoaded = false;
let tiktokLoaded = false;
let googleLoaded = false;

function injectScript(src: string): void {
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
}

/** Loads the Meta Pixel base code and fires PageView. `eventId` (when known) lets Meta de-duplicate against the server-side Conversions API event. */
export function loadMetaPixel(pixelId: string, eventId?: string): void {
  if (metaLoaded || typeof window === 'undefined') return;
  metaLoaded = true;
  const w = window as WindowWithFbq;
  if (!w.fbq) {
    const fbq: Fbq = Object.assign(
      (...args: unknown[]) => {
        fbq.queue.push(args);
      },
      { queue: [] as unknown[], loaded: true },
    );
    w.fbq = fbq;
    if (!w._fbq) w._fbq = fbq;
    injectScript('https://connect.facebook.net/en_US/fbevents.js');
  }
  w.fbq('init', pixelId);
  w.fbq('track', 'PageView', {}, eventId ? { eventID: eventId } : undefined);
}

/**
 * Loads Google's gtag and fires a config call, which on a Google Ads tag
 * also reports a page conversion event where set up. Consent Mode defaults
 * and updates are owned by the consent banner (lib/tracking/client.ts):
 * this function never overrides them, so a later withdrawal still applies.
 */
export function loadGoogleTag(conversionId: string, eventId?: string): void {
  if (googleLoaded || typeof window === 'undefined') return;
  googleLoaded = true;
  const w = window as WindowWithGtag;
  w.dataLayer = w.dataLayer || [];
  if (!w.gtag) {
    w.gtag = function gtag() {
      // gtag.js only processes Arguments objects, not arrays.
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    };
  }
  w.gtag('js', new Date());
  w.gtag('config', conversionId, eventId ? { event_id: eventId } : undefined);
  injectScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(conversionId)}`);
}

/**
 * Called when the visitor withdraws advertising consent on the same page.
 * Google is covered by the Consent Mode update the banner sends; Meta and
 * TikTok are told to stop through their own consent APIs.
 */
export function revokeAdvertisingPixels(): void {
  if (typeof window === 'undefined') return;
  const w = window as WindowWithFbq & WindowWithTtq;
  if (metaLoaded && w.fbq) w.fbq('consent', 'revoke');
  if (tiktokLoaded && w.ttq && typeof w.ttq.revokeConsent === 'function') w.ttq.revokeConsent();
}

/** Loads the TikTok Pixel and fires its page view event. */
export function loadTikTokPixel(pixelCode: string): void {
  if (tiktokLoaded || typeof window === 'undefined') return;
  tiktokLoaded = true;
  const w = window as WindowWithTtq;
  if (!w.ttq) {
    injectScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(pixelCode)}&lib=ttq`);
  }
  // ttq is only available once the script above finishes loading; a short
  // poll is simpler and safer here than depending on the vendor snippet's
  // exact queuing internals, which change between versions.
  const start = Date.now();
  const tryLoad = () => {
    const ttq = (window as WindowWithTtq).ttq;
    if (ttq) {
      ttq.load(pixelCode);
      ttq.page();
      return;
    }
    if (Date.now() - start < 5000) setTimeout(tryLoad, 100);
  };
  tryLoad();
}

/**
 * Loads whichever pixels the tenant has connected. Called once consent and
 * an active connection are both confirmed. `eventId`, when the page already
 * has one (a form/booking/checkout response carried it), is passed through
 * for Meta's event de-duplication with the server-side CAPI event.
 */
export async function loadActivePixels(studioSlug: string, eventId?: string): Promise<void> {
  const config = await fetchAdsPixelConfig(studioSlug);
  if (config.meta) loadMetaPixel(config.meta.pixelId, eventId);
  if (config.google) loadGoogleTag(config.google.conversionId, eventId);
  if (config.tiktok) loadTikTokPixel(config.tiktok.pixelCode);
}
