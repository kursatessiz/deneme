import { BASE_LOCALE, BUNDLED_MESSAGES } from '@platform/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';

/**
 * This locale's bundled messages merged with its CMS overrides (fetched
 * from the public GET /i18n/messages/:locale). A short revalidate window
 * means CMS edits apply within a few minutes without a redeploy, while
 * still allowing Next.js to cache the response across requests.
 *
 * Falls back to the bundled messages alone (or the base/Turkish ones if the
 * locale is not bundled either) when the API is unreachable, so a slow or
 * failing API never blocks a page render.
 */
export async function getLocaleMessages(locale: string): Promise<Record<string, string>> {
  const bundled: Record<string, string> = { ...(BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE]) };
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/i18n/messages/${encodeURIComponent(locale)}`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return bundled;
    const data = (await res.json()) as { messages: Record<string, string> };
    return { ...bundled, ...data.messages };
  } catch {
    return bundled;
  }
}

/** Enabled language codes, for validating a candidate locale before using it. Falls back to the bundled set. */
export async function getEnabledLocales(): Promise<string[]> {
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/i18n/languages`, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error('i18n/languages request failed');
    const data = (await res.json()) as { items: { code: string }[] };
    return data.items.map((i) => i.code);
  } catch {
    return Object.keys(BUNDLED_MESSAGES);
  }
}
