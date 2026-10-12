import { Linking } from 'react-native';

/**
 * Every link the app opens in the system browser or another app goes through
 * here. Links come from the server (tenant data, payment and meeting
 * providers), so only https URLs are opened by default; a caller that needs
 * the app's own scheme (webcal for the calendar feed) names it explicitly.
 * javascript:, intent:, file:, http: and custom schemes are never opened.
 */
export function isOpenableUrl(url: string | null | undefined, extraSchemes: readonly string[] = []): url is string {
  if (typeof url !== 'string' || url.length === 0 || url !== url.trim()) return false;
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!match) return false;
  const scheme = `${match[1].toLowerCase()}:`;
  if (scheme === 'https:') return /^https:\/\/[^/\s]+/i.test(url) && !/^https:\/\/[^/?#]*@/i.test(url);
  return extraSchemes.map((s) => s.toLowerCase()).includes(scheme) && /^[a-z][a-z0-9+.-]*:\/\/[^/\s]+/i.test(url);
}

/** Opens an https URL (or one of `extraSchemes`); throws for anything else so the caller shows its error. */
export async function openExternalUrl(url: string | null | undefined, extraSchemes: readonly string[] = []): Promise<void> {
  if (!isOpenableUrl(url, extraSchemes)) throw new Error('Blocked external URL');
  await Linking.openURL(url);
}
