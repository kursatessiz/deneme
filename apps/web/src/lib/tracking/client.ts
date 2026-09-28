import { SESSION_COOKIE, SESSION_IDLE_MINUTES, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE_DAYS } from '@platform/shared';
import { CONSENT_COOKIE, CONSENT_COOKIE_MAX_AGE_DAYS, serializeConsent } from './consent';
import type { ConsentChoice, ConsentState } from './consent';
import type { ConsentMode } from './region';
import { buildTouchpoint, shouldSendTouchpoint } from './touchpoint';

/**
 * Browser side of visitor tracking (docs/CRM_VE_ATIF.md). First-party
 * cookies only: pw_vid (anonymous visitor, 13 months) and pw_sid (session,
 * 30 minutes idle). Neither is written before the visitor's consent allows
 * analytics; withdrawing consent deletes both.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
}

function deleteCookie(name: string): void {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newId(): string {
  return crypto.randomUUID();
}

export function readStoredConsent(): string | undefined {
  return readCookie(CONSENT_COOKIE);
}

export function storeConsent(choice: ConsentChoice): void {
  writeCookie(CONSENT_COOKIE, serializeConsent(choice), CONSENT_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60);
}

/** Removes the tracking cookies (consent withdrawn or rejected). */
export function clearTrackingCookies(): void {
  deleteCookie(VISITOR_COOKIE);
  deleteCookie(SESSION_COOKIE);
}

/** The anonymous visitor id, only when tracking consent created one. */
export function getVisitorId(): string | null {
  const vid = readCookie(VISITOR_COOKIE);
  return vid && UUID.test(vid) ? vid : null;
}

/** Headers for form and booking submissions to the API (cross-origin, so the cookie itself is not sent). */
export function trackingHeaders(): Record<string, string> {
  const vid = getVisitorId();
  return vid ? { 'X-PW-VID': vid } : {};
}

/** Reads or creates pw_vid and pw_sid, sliding the session's idle expiry. */
function ensureIds(): { visitorId: string; sessionId: string; newSession: boolean } {
  let visitorId = readCookie(VISITOR_COOKIE);
  if (!visitorId || !UUID.test(visitorId)) visitorId = newId();
  writeCookie(VISITOR_COOKIE, visitorId, VISITOR_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60);

  let sessionId = readCookie(SESSION_COOKIE);
  const newSession = !sessionId || !UUID.test(sessionId);
  if (newSession) sessionId = newId();
  writeCookie(SESSION_COOKIE, sessionId as string, SESSION_IDLE_MINUTES * 60);
  return { visitorId, sessionId: sessionId as string, newSession };
}

/**
 * Called on every page view of a public page. Does nothing without
 * analytics consent; otherwise sends the touchpoint on the first page of
 * a session and whenever the URL carries tracking parameters.
 */
export async function trackPageView(opts: { studioSlug: string; consent: ConsentState; locale: string }): Promise<boolean> {
  if (!opts.consent.analytics) return false;
  const ids = ensureIds();
  const url = window.location.href;
  if (!shouldSendTouchpoint(ids.newSession, url)) return false;
  const payload = buildTouchpoint({
    visitorId: ids.visitorId,
    sessionId: ids.sessionId,
    url,
    referrer: document.referrer,
    locale: opts.locale,
    consent: opts.consent,
    fbpCookie: readCookie('_fbp'),
    fbcCookie: readCookie('_fbc'),
    now: Date.now(),
  });
  try {
    await fetch(`${API_BASE_URL}/track/${encodeURIComponent(opts.studioSlug)}/touchpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return true;
  } catch {
    // Tracking must never break the page.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Google Consent Mode v2
// ---------------------------------------------------------------------------

type ConsentValue = 'granted' | 'denied';
type WindowWithDataLayer = Window & { dataLayer?: unknown[] };

function gtag(..._args: unknown[]): void {
  const w = window as WindowWithDataLayer;
  w.dataLayer = w.dataLayer ?? [];
  // gtag.js reads the Arguments object, not an array.
  // eslint-disable-next-line prefer-rest-params
  w.dataLayer.push(arguments);
}

function consentSignals(state: ConsentChoice): Record<string, ConsentValue> {
  const analytics: ConsentValue = state.analytics ? 'granted' : 'denied';
  const ads: ConsentValue = state.analytics && state.advertising ? 'granted' : 'denied';
  return { analytics_storage: analytics, ad_storage: ads, ad_user_data: ads, ad_personalization: ads };
}

/** Consent Mode defaults, pushed before any Google tag could load: denied where consent is required. */
export function consentModeDefault(mode: ConsentMode, initial: ConsentState): void {
  const signals =
    mode === 'notice'
      ? consentSignals(initial)
      : { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
  gtag('consent', 'default', { ...signals, wait_for_update: 500 });
}

export function consentModeUpdate(state: ConsentChoice): void {
  gtag('consent', 'update', consentSignals(state));
}
