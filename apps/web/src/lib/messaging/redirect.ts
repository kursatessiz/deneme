/**
 * The click route only ever redirects to an absolute http(s) URL the API
 * returned for a stored link (defence in depth: the API already refuses to
 * store anything else). Anything else, including javascript: or
 * protocol-relative values, yields null and the caller goes to the site root.
 */
export function safeRedirectTarget(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.toString();
}
