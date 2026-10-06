import {
  BASE_LOCALE,
  BASE_MESSAGES,
  BUNDLED_LANGUAGES,
  BUNDLED_MESSAGES,
  createTranslator,
  parseAcceptLanguage,
  resolveLocale,
} from '@platform/shared';
import type { Translate } from '@platform/shared';
import { PW_LOCALE_COOKIE } from '@/lib/i18n/constants';

/**
 * Translator for the language of one incoming request, for route handlers
 * that answer with a user-visible message: the pw_locale cookie first, then
 * Accept-Language, then Turkish. Bundled messages only (no network call on
 * the error path), same resolution as translate-error.ts.
 */
export function requestTranslator(req: { cookies: { get(name: string): { value: string } | undefined }; headers: Headers }): Translate {
  const enabled = BUNDLED_LANGUAGES.map((l) => l.code);
  const locale = resolveLocale(enabled, [req.cookies.get(PW_LOCALE_COOKIE)?.value, ...parseAcceptLanguage(req.headers.get('accept-language')), BASE_LOCALE]);
  return createTranslator({ locale, messages: BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
}
