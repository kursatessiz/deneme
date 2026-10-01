import { NextRequest } from 'next/server';
import { PW_LOCALE_COOKIE } from '@/lib/i18n/constants';
import { fetchPlatformHomeLocales } from '@/lib/sites/api';
import { negotiateRootLocale } from '@/lib/sites/root-locale';

/**
 * The origin root belongs to the page engine (docs/SAYFA_MOTORU.md): it redirects to the platform home page
 * in the visitor's locale (`pw_locale` cookie, then Accept-Language), limited to the locales the home page
 * is published in; the query string (the badge's UTM attribution) is kept. 302 because the target depends on the request; Vary tells caches why. A tenant host is
 * rewritten by the middleware before it gets here.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { locales, defaultLocale } = await fetchPlatformHomeLocales();
  const locale = negotiateRootLocale({
    cookie: request.cookies.get(PW_LOCALE_COOKIE)?.value,
    acceptLanguage: request.headers.get('accept-language'),
    published: locales,
    defaultLocale,
  });
  return new Response(null, {
    status: 302,
    headers: { Location: `/${locale}${request.nextUrl.search}`, Vary: 'Accept-Language, Cookie', 'Cache-Control': 'private, max-age=0' },
  });
}
