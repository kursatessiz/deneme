import { BASE_MESSAGES, BUNDLED_MESSAGES, createTranslator } from '@platform/shared';
import type { I18nService } from '../i18n/i18n.service';

/**
 * Translator for export headers and labels in the requested locale,
 * including uploaded language packs and admin (CMS) overrides: the same
 * effective messages the public i18n endpoint serves (I18nService), layered
 * as bundled base language < effective base language < effective exact
 * locale ("en" under "en-GB"), with the Turkish base catalogue as the last
 * fallback. A disabled or unknown language falls back to what is bundled.
 */
export async function exportTranslator(i18n: Pick<I18nService, 'getLocaleMessages'>, locale: string): Promise<(key: string) => string> {
  const language = locale.split('-')[0];
  const [exact, base] = await Promise.all([
    i18n.getLocaleMessages(locale),
    language !== locale ? i18n.getLocaleMessages(language) : Promise.resolve(null),
  ]);
  const messages: Record<string, string> = {
    ...(BUNDLED_MESSAGES[language] ?? {}),
    ...(BUNDLED_MESSAGES[locale] ?? {}),
    ...(base?.messages ?? {}),
    ...(exact?.messages ?? {}),
  };
  return createTranslator({ locale, messages, fallback: BASE_MESSAGES });
}
