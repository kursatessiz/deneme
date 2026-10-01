/**
 * Open Graph locale (`language_TERRITORY`) for a BCP 47 language tag, using the
 * likely territory from Intl (`tr` -> `tr_TR`); no per-language table.
 */
export function toOgLocale(locale: string): string {
  try {
    const { language, region } = new Intl.Locale(locale).maximize();
    return region ? `${language}_${region}` : language;
  } catch {
    return locale;
  }
}
