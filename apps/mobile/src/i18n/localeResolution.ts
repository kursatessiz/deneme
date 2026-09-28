/**
 * Pure locale-resolution and cache-freshness helpers, kept free of React
 * Native imports so they can be unit-tested with plain jest (see
 * localeResolution.spec.ts and the mobile jest.config.js testMatch).
 *
 * The actual pick between candidates is packages/shared's resolveLocale;
 * this module only builds the candidate list in the order CLAUDE.md and the
 * mobile i18n spec describe, and decides when a cached message set is stale.
 */

/** Ten minutes: how often the app foreground handler re-checks for new messages. */
export const MESSAGES_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export interface LocaleCandidatesInput {
  /** True once a session user has been restored or signed in. */
  isSignedIn: boolean;
  /** SessionUserDTO.locale: the user's own choice, null follows the studio. */
  userLocale?: string | null;
  /** The active membership's MembershipDTO.defaultLocale. */
  studioDefaultLocale?: string | null;
  /** A choice saved locally before sign-in (see localePreferenceStore). */
  storedLocale?: string | null;
  /** expo-localization getLocales() language tags, most preferred first. */
  deviceLocales: readonly string[];
}

/**
 * Builds the ordered candidate list passed to resolveLocale(enabled, ...).
 * Signed in: the user's own choice, then the active studio's default, then
 * the device. Signed out: the device, preceded by the last-chosen device
 * (see-you-again) locale if one is on record. `resolveLocale` matches
 * region-qualified tags (e.g. "en-GB") and falls back to BASE_LOCALE, so
 * this function never needs to fall back to a hardcoded value itself.
 */
export function buildLocaleCandidates(
  input: LocaleCandidatesInput,
): Array<string | null | undefined> {
  const { isSignedIn, userLocale, studioDefaultLocale, storedLocale, deviceLocales } = input;
  if (isSignedIn) {
    return [userLocale, studioDefaultLocale, ...deviceLocales];
  }
  return [storedLocale, ...deviceLocales];
}

/**
 * True when a fresh fetch of /i18n/messages/:locale is due: no fetch is on
 * record, the locale changed since the last fetch, or the last fetch is
 * older than `minIntervalMs` (default MESSAGES_REFRESH_INTERVAL_MS).
 */
export function shouldRefetchMessages(
  cache: { locale: string; fetchedAt: number } | null,
  locale: string,
  now: number,
  minIntervalMs: number = MESSAGES_REFRESH_INTERVAL_MS,
): boolean {
  if (!cache || cache.locale !== locale) return true;
  return now - cache.fetchedAt >= minIntervalMs;
}

/**
 * Merges this locale's own values over the bundled base catalogue. A null
 * override (nothing cached or fetched yet) leaves the bundled messages as
 * they are; the translator itself falls back to Turkish for any key still
 * missing after this merge.
 */
export function mergeMessages(
  bundled: Readonly<Record<string, string>>,
  override: Readonly<Record<string, string>> | null | undefined,
): Record<string, string> {
  return override ? { ...bundled, ...override } : { ...bundled };
}
