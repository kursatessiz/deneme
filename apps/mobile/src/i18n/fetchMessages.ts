import type { LocaleMessagesDTO, PublicLanguagesDTO } from '@platform/shared';

import { resolveApiUrl } from '../lib/api';

/**
 * Direct fetch calls for the two public i18n endpoints (GET /i18n/languages,
 * GET /i18n/messages/:locale). These bypass lib/api.ts's apiRequest because
 * that helper parses the JSON body and discards headers, while the messages
 * endpoint's ETag/If-None-Match/304 contract (packages/shared/src/i18n/locales.ts)
 * needs the response headers and status.
 */

export async function fetchPublicLanguages(): Promise<PublicLanguagesDTO | null> {
  try {
    const response = await fetch(`${resolveApiUrl()}/i18n/languages`);
    if (!response.ok) return null;
    return (await response.json()) as PublicLanguagesDTO;
  } catch {
    return null;
  }
}

export type FetchMessagesResult =
  | { status: 'ok'; data: LocaleMessagesDTO }
  | { status: 'not-modified' }
  | { status: 'error' };

/** If `knownVersion` is given, sends it as If-None-Match; a 304 means the cache is still current. */
export async function fetchLocaleMessages(locale: string, knownVersion?: string): Promise<FetchMessagesResult> {
  try {
    const headers: Record<string, string> = {};
    if (knownVersion) headers['If-None-Match'] = knownVersion;
    const response = await fetch(`${resolveApiUrl()}/i18n/messages/${encodeURIComponent(locale)}`, { headers });
    if (response.status === 304) return { status: 'not-modified' };
    if (!response.ok) return { status: 'error' };
    const data = (await response.json()) as LocaleMessagesDTO;
    return { status: 'ok', data };
  } catch {
    return { status: 'error' };
  }
}
