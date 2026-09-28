import { VISITOR_COOKIE } from '@platform/shared';

/**
 * Request helpers for visitor tracking. Nothing here stores or returns an
 * IP address; the country comes from a header the edge proxy sets.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedLanding {
  host: string;
  /** Path only: query string and fragment removed, capped at 2000 characters. */
  path: string;
}

/** Splits a landing URL into host and path. Returns null for anything that is not http(s). */
export function parseLanding(url: string): ParsedLanding | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const path = (parsed.pathname || '/').slice(0, 2000);
  return { host: parsed.host.toLowerCase().slice(0, 255), path };
}

/** Host of the referring page, or null when absent, unparsable or the same site. */
export function referrerHostOf(referrer: string | undefined, landingHost: string): string | null {
  if (!referrer) return null;
  try {
    const parsed = new URL(referrer);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.host.toLowerCase();
    return host === landingHost ? null : host.slice(0, 255);
  } catch {
    return null;
  }
}

const BOT_PATTERN =
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebookcatalog|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget\/|python-requests|httpclient|go-http-client|okhttp|axios\/|node-fetch|java\/|scrapy|phantomjs|puppeteer|playwright/i;

/**
 * Heuristic bot filter. A missing or very short user agent is treated as a
 * bot too: every real browser sends one. Browsers in the old headless
 * mode announce "HeadlessChrome" and are ignored; test traffic that looks
 * like a real browser is marked through Contact.isTest instead.
 */
export function isLikelyBot(userAgent: string | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 12) return true;
  return BOT_PATTERN.test(userAgent);
}

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export function deviceTypeOf(userAgent: string | undefined): DeviceType | null {
  if (!userAgent) return null;
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Coarse visitor country from the edge proxy: Cloudflare's CF-IPCountry or
 * the X-Country-Code header Caddy can set. Placeholder codes (XX unknown,
 * T1 Tor) are ignored.
 */
export function countryFromHeaders(headers: Headers): string | null {
  const raw = header(headers, 'cf-ipcountry') ?? header(headers, 'x-country-code');
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return null;
  return code;
}

/**
 * The anonymous visitor id (pw_vid) a public form or booking request
 * carries: the X-PW-VID header set by the web tracking client (the API is
 * cross-origin, so its own cookie jar never sees the site's cookie), or
 * the pw_vid cookie when the API shares the site's domain.
 */
export function readVisitorId(headers: Headers): string | null {
  const fromHeader = header(headers, 'x-pw-vid');
  if (fromHeader && UUID.test(fromHeader.trim())) return fromHeader.trim().toLowerCase();
  const cookie = header(headers, 'cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== VISITOR_COOKIE) continue;
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
    return UUID.test(value) ? value.toLowerCase() : null;
  }
  return null;
}
