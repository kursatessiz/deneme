import { headers, cookies } from 'next/headers';
import { parseAcceptLanguage, resolveLocale } from '@platform/shared';
import { getServerSession } from '@/lib/session/server-session';
import { getEnabledLocales } from './messages';
import { PW_LOCALE_COOKIE } from './constants';

export { PW_LOCALE_COOKIE };

/**
 * Locale resolution order (see docs/I18N.md): the signed-in user's own
 * choice, then their active studio's default, then the `pw_locale` cookie
 * (set by the login page for unauthenticated visitors), then the browser's
 * Accept-Language header, then Turkish. Only enabled languages are
 * candidates; an unrecognized or now-disabled choice falls through.
 */
export async function resolveRequestLocale(): Promise<string> {
  const [session, jar, headerList, enabled] = await Promise.all([
    getServerSession(),
    cookies(),
    headers(),
    getEnabledLocales(),
  ]);

  const candidates: (string | null | undefined)[] = [];
  if (session) {
    candidates.push(session.user.locale, session.activeMembership.defaultLocale);
  }
  candidates.push(jar.get(PW_LOCALE_COOKIE)?.value);
  candidates.push(...parseAcceptLanguage(headerList.get('accept-language')));

  return resolveLocale(enabled, candidates);
}
