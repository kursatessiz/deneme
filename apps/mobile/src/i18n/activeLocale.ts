/**
 * The locale the app currently renders in, kept outside React so the fetch
 * wrappers (apiRequest, kioskRequest) can send it as Accept-Language and
 * translate API error bodies with it. I18nProvider updates it whenever the
 * resolved locale changes; until then callers fall back to the stored
 * choice and the device language (see offlineTranslate.ts).
 */
let activeLocale: string | null = null;

export function setActiveLocale(locale: string | null): void {
  activeLocale = locale;
}

export function getActiveLocale(): string | null {
  return activeLocale;
}
