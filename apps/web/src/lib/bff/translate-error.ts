import {
  BASE_LOCALE,
  BASE_MESSAGES,
  BUNDLED_LANGUAGES,
  BUNDLED_MESSAGES,
  createTranslator,
  parseAcceptLanguage,
  resolveLocale,
  translateApiErrorBody,
} from '@platform/shared';

/**
 * API errors whose `code` has a translation get their `message` replaced by
 * it in the viewer's language, so every screen that shows `err.message`
 * shows it translated without knowing the code. A code is translatable when
 * it is an `apiErrors.*` message key (the API sends `params` for its
 * placeholders), a shared code such as BILLING_RESTRICTED, or a module code
 * such as RETAIL_PRODUCT_NOT_FOUND (see `translateApiErrorBody`). The locale
 * comes from the pw_locale cookie, then Accept-Language, then Turkish; only
 * bundled messages are used (no network call on the error path).
 */
export function translateApiError(
  body: Record<string, unknown> | null,
  localeCookie: string | undefined,
  acceptLanguage: string | null,
): Record<string, unknown> | null {
  if (!body) return body;
  const enabled = BUNDLED_LANGUAGES.map((l) => l.code);
  const locale = resolveLocale(enabled, [localeCookie, ...parseAcceptLanguage(acceptLanguage), BASE_LOCALE]);
  const t = createTranslator({ locale, messages: BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
  return translateApiErrorBody(body, t);
}
