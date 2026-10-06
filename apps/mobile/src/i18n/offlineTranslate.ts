import * as Localization from 'expo-localization';

import { BASE_LOCALE, BUNDLED_LANGUAGES, BUNDLED_MESSAGES, createTranslator } from '@platform/shared';
import { resolveLocale } from '@platform/shared';
import type { Translate } from '@platform/shared';

import { getActiveLocale } from './activeLocale';
import { getStoredLocaleChoice } from './storage';

/**
 * A translator for code that runs outside the React tree and cannot read
 * I18nProvider's context (the low-level `apiRequest`/`kioskRequest` fetch
 * wrappers, whose thrown ApiError messages are shown directly by many
 * screens). Mirrors the device-locale/stored-choice fallback I18nProvider
 * uses before first render, using only bundled (offline) messages -- no
 * network call, since this runs on the error path of a failed request.
 */
export async function resolveOfflineLocale(): Promise<string> {
  const enabledCodes = BUNDLED_LANGUAGES.map((language) => language.code);
  // The locale I18nProvider resolved (user choice, studio default, ...) wins once the app has rendered.
  const active = getActiveLocale();
  if (active && (enabledCodes as readonly string[]).includes(active)) return active;
  const stored = await getStoredLocaleChoice();
  let deviceLocales: string[] = [];
  try {
    deviceLocales = Localization.getLocales()
      .map((entry) => entry.languageTag)
      .filter((tag): tag is string => Boolean(tag));
  } catch {
    deviceLocales = [];
  }
  return resolveLocale(enabledCodes, [stored, ...deviceLocales, BASE_LOCALE]);
}

export async function resolveOfflineTranslate(): Promise<Translate> {
  const locale = await resolveOfflineLocale();
  const messages = BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
  return createTranslator({ locale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] });
}
