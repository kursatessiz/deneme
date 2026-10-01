import { INDEXNOW_KEY_PATTERN } from '@platform/shared';

/** Request header the middleware sets to the visitor's Host on the rewrite to the key file route. */
export const ORIGINAL_HOST_HEADER = 'x-pw-original-host';

/** The IndexNow key of a `/<key>.txt` request path; null for any other path (docs/SEO.md "IndexNow"). */
export function indexNowKeyFromPath(pathname: string): string | null {
  const match = /^\/([a-f0-9]{32})\.txt$/.exec(pathname);
  return match && INDEXNOW_KEY_PATTERN.test(match[1]) ? match[1] : null;
}
