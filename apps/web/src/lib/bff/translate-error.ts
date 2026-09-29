import {
  BASE_LOCALE,
  BASE_MESSAGES,
  BUNDLED_LANGUAGES,
  BUNDLED_MESSAGES,
  TRANSLATED_API_ERROR_CODES,
  createTranslator,
  parseAcceptLanguage,
  resolveLocale,
} from '@platform/shared';

/**
 * API errors with a stable code that has a shared translation (e.g.
 * BILLING_RESTRICTED in restricted mode) get their `message` replaced by
 * the translation in the viewer's language, so every screen that shows
 * `err.message` shows it translated without knowing the code. The locale
 * comes from the pw_locale cookie, then Accept-Language, then Turkish;
 * only bundled messages are used (no network call on the error path).
 */
export function translateApiError(
  body: Record<string, unknown> | null,
  localeCookie: string | undefined,
  acceptLanguage: string | null,
): Record<string, unknown> | null {
  if (!body || typeof body.code !== 'string') return body;
  const key = TRANSLATED_API_ERROR_CODES[body.code];
  if (!key) return body;
  const enabled = BUNDLED_LANGUAGES.map((l) => l.code);
  const locale = resolveLocale(enabled, [localeCookie, ...parseAcceptLanguage(acceptLanguage), BASE_LOCALE]);
  const t = createTranslator({ locale, messages: BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
  return { ...body, message: t(key) };
}
