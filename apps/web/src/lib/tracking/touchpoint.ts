import { parseTrackingParams } from '@platform/shared';
import type { TouchpointInput } from '@platform/shared';
import type { ConsentChoice } from './consent';

/** Pure helpers of the tracking client; no DOM access, unit tested. */

export function hasTrackingParams(url: string): boolean {
  const p = parseTrackingParams(url);
  return [p.utm, p.adIds, p.clickIds].some((group) => Object.values(group).some(Boolean));
}

/** Send once per session, and again whenever the landing URL carries tracking parameters. */
export function shouldSendTouchpoint(newSession: boolean, url: string): boolean {
  return newSession || hasTrackingParams(url);
}

/** Meta's click cookie format, derived from fbclid when the Meta pixel has not set _fbc itself. */
export function fbcFromFbclid(fbclid: string | undefined, now: number): string | undefined {
  return fbclid ? `fb.1.${now}.${fbclid}` : undefined;
}

export interface TouchpointContext {
  visitorId: string;
  sessionId: string;
  url: string;
  referrer: string;
  locale: string;
  consent: ConsentChoice;
  /** Meta cookies as read from the page (only used with advertising consent). */
  fbpCookie?: string;
  fbcCookie?: string;
  pageVariant?: string;
  now: number;
}

export function buildTouchpoint(ctx: TouchpointContext): TouchpointInput {
  const params = parseTrackingParams(ctx.url);
  const advertising = ctx.consent.analytics && ctx.consent.advertising;
  const fbc = advertising ? ctx.fbcCookie ?? fbcFromFbclid(params.clickIds.fbclid, ctx.now) : undefined;
  return {
    visitorId: ctx.visitorId,
    sessionId: ctx.sessionId,
    landingUrl: ctx.url.slice(0, 2000),
    ...(ctx.referrer ? { referrer: ctx.referrer.slice(0, 2000) } : {}),
    utm: params.utm,
    adIds: params.adIds,
    clickIds: advertising ? params.clickIds : {},
    ...(advertising && ctx.fbpCookie ? { fbp: ctx.fbpCookie.slice(0, 250) } : {}),
    ...(fbc ? { fbc: fbc.slice(0, 250) } : {}),
    locale: ctx.locale.slice(0, 10),
    ...(ctx.pageVariant ? { pageVariant: ctx.pageVariant } : {}),
    consent: { analytics: ctx.consent.analytics, advertising },
  };
}
