/**
 * The browser-facing API origin (lead forms, visitor tracking, ad pixel
 * config, the embed widget), resolved at RUNTIME so one web image built
 * once per commit serves preprod and production alike (docs/CICD_GUIDE.md
 * "Preprod ortamı").
 *
 * - Server (middleware, server components): the `PUBLIC_API_URL` server
 *   env var, set by deploy/docker-compose.prod.yml to https://<API_DOMAIN>.
 * - Browser: the root layout renders that value into
 *   `<meta name="platform-public-api-url">` (no inline script, so the nonce
 *   CSP is untouched); client code reads it at call time.
 *
 * `NEXT_PUBLIC_API_URL` is only a local development fallback: Next.js
 * inlines it at build time, so it must never be what production relies on.
 */

export const PUBLIC_API_URL_META = 'platform-public-api-url';

const DEV_FALLBACK = 'http://localhost:4000';

/** An http(s) base URL without credentials, query or trailing slash; null when invalid or empty. */
export function normalizeApiBaseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/** Server side: the runtime `PUBLIC_API_URL`, then the development fallbacks. */
export function serverPublicApiUrl(env: { PUBLIC_API_URL?: string; NEXT_PUBLIC_API_URL?: string } = readServerEnv()): string {
  return normalizeApiBaseUrl(env.PUBLIC_API_URL) ?? normalizeApiBaseUrl(env.NEXT_PUBLIC_API_URL) ?? DEV_FALLBACK;
}

/** Origin only (scheme, host, port), for CSP source lists. */
export function apiOrigin(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

/** Browser: the value the root layout rendered; null when the tag is missing or invalid. */
export function publicApiUrlFromDocument(doc: Pick<Document, 'querySelector'>): string | null {
  if (typeof doc.querySelector !== 'function') return null; // partial document stubs (unit tests)
  const content = doc.querySelector(`meta[name="${PUBLIC_API_URL_META}"]`)?.getAttribute('content');
  return normalizeApiBaseUrl(content);
}

/** For any code that may run on either side; client code calls it at request time, never at module load. */
export function publicApiBaseUrl(): string {
  if (typeof document !== 'undefined') {
    return publicApiUrlFromDocument(document) ?? normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL) ?? DEV_FALLBACK;
  }
  return serverPublicApiUrl();
}

function readServerEnv(): { PUBLIC_API_URL?: string; NEXT_PUBLIC_API_URL?: string } {
  // Explicit property reads: `PUBLIC_API_URL` stays a runtime lookup, only
  // the NEXT_PUBLIC_ fallback is inlined by the Next.js compiler.
  return { PUBLIC_API_URL: process.env.PUBLIC_API_URL, NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL };
}
