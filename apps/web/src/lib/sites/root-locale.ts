import { BASE_LOCALE, parseAcceptLanguage } from '@platform/shared';

export interface RootLocaleInput {
  /** Value of the `pw_locale` cookie, if any. */
  cookie: string | null | undefined;
  /** Raw Accept-Language header. */
  acceptLanguage: string | null | undefined;
  /** Locales in which the platform home page is published. */
  published: readonly string[];
  /** The platform site's default locale. */
  defaultLocale: string | null;
}

/**
 * Locale the origin root `/` redirects to: the visitor's `pw_locale` cookie, then Accept-Language, both
 * restricted to the locales the platform home page is published in (a region tag such as `en-GB` matches `en`),
 * then the site default, then the first published locale, then BASE_LOCALE (docs/SEO.md).
 */
export function negotiateRootLocale(input: RootLocaleInput): string {
  const { published } = input;
  if (published.length === 0) return BASE_LOCALE;
  const set = new Set(published);
  const candidates = [input.cookie, ...parseAcceptLanguage(input.acceptLanguage)];
  for (const raw of candidates) {
    if (!raw) continue;
    if (set.has(raw)) return raw;
    const language = raw.split('-')[0].toLowerCase();
    if (set.has(language)) return language;
  }
  if (input.defaultLocale && set.has(input.defaultLocale)) return input.defaultLocale;
  return published[0];
}
