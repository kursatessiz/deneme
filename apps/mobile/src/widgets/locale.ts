import * as Localization from 'expo-localization';

import { BASE_LOCALE, BUNDLED_LANGUAGES, BUNDLED_MESSAGES, createTranslator, resolveLocale } from '@platform/shared';
import type { Translate } from '@platform/shared';

import { getStoredLocaleChoice } from '../i18n/storage';

/**
 * Resolves the locale to render the home-screen widgets in. Widgets run
 * outside the app's React tree (headless task or a native-compiled layout),
 * so they cannot read I18nProvider's context; instead they use the same
 * device-locale/stored-choice fallback the app uses before sign-in. Only
 * bundled locales (tr, en) are candidates -- widgets never fetch a CMS
 * language pack over the network.
 */
export async function resolveWidgetLocale(): Promise<string> {
  const stored = await getStoredLocaleChoice();
  let deviceLocales: string[] = [];
  try {
    deviceLocales = Localization.getLocales()
      .map((entry) => entry.languageTag)
      .filter((tag): tag is string => Boolean(tag));
  } catch {
    deviceLocales = [];
  }
  const enabledCodes = BUNDLED_LANGUAGES.map((language) => language.code);
  return resolveLocale(enabledCodes, [stored, ...deviceLocales, BASE_LOCALE]);
}

/** The widget's resolved locale plus a translator bound to it, using only bundled (offline) messages. */
export async function resolveWidgetTranslation(): Promise<{ locale: string; t: Translate }> {
  const locale = await resolveWidgetLocale();
  const messages = BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
  const t = createTranslator({ locale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] });
  return { locale, t };
}
