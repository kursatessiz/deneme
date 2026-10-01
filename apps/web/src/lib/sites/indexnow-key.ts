import { INDEXNOW_KEY_PATTERN } from '@platform/shared';

/** The IndexNow key of a `/<key>.txt` request path; null for any other path (docs/SEO.md "IndexNow"). */
export function indexNowKeyFromPath(pathname: string): string | null {
  const match = /^\/([a-f0-9]{32})\.txt$/.exec(pathname);
  return match && INDEXNOW_KEY_PATTERN.test(match[1]) ? match[1] : null;
}
