import { BASE_LOCALE } from '@platform/shared';
import { getEnabledLocales } from '@/lib/i18n/messages';

/**
 * The `<html lang>` and message locale of a page engine route: the URL's locale when it is an enabled language,
 * the base language otherwise (an unknown locale renders the 404 page). Derived from the URL only, never from
 * cookies or headers, so the page can be cached (ISR, docs/SEO.md).
 */
export async function documentLocale(urlLocale: string): Promise<string> {
  const enabled = await getEnabledLocales();
  return enabled.includes(urlLocale) ? urlLocale : BASE_LOCALE;
}
