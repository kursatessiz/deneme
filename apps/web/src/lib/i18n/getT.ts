import { BASE_MESSAGES, createTranslator, type Translate } from '@platform/shared';
import { resolveRequestLocale } from './locale';
import { getLocaleMessages } from './messages';

/**
 * Server-component equivalent of useT(): `const { t, locale } = await getT()`.
 * Resolves the request's locale the same way the root layout does and loads
 * that locale's messages (bundled + CMS overrides).
 */
export async function getT(): Promise<{ t: Translate; locale: string }> {
  const locale = await resolveRequestLocale();
  const messages = await getLocaleMessages(locale);
  return { t: createTranslator({ locale, messages, fallback: BASE_MESSAGES }), locale };
}

/**
 * Same as getT(), but for an explicit locale rather than the request's own.
 * Used by the page engine's public rendering (apps/web/src/components/sites),
 * where the text language is the page's own locale (from the URL), not the
 * viewer's app-locale preference.
 */
export async function getTFor(locale: string): Promise<Translate> {
  const messages = await getLocaleMessages(locale);
  return createTranslator({ locale, messages, fallback: BASE_MESSAGES });
}
