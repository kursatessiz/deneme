import { redirect } from 'next/navigation';
import { resolveRequestLocale } from '@/lib/i18n/locale';
import { fetchPublicPage } from '@/lib/sites/api';

/**
 * The platform home is now rendered by the page engine at `/[locale]`
 * (docs/SAYFA_MOTORU.md). `/` keeps working by redirecting to the
 * visitor's best locale, falling back to Turkish when that locale has no
 * published home page yet.
 */
export default async function RootRedirect() {
  const preferred = await resolveRequestLocale();
  const home = await fetchPublicPage('platform', preferred, '');
  redirect(`/${home ? preferred : 'tr'}`);
}
