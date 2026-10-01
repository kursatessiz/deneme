import type { Metadata } from 'next';
import { getTFor } from '@/lib/i18n/getT';
import { getLocaleMessages } from '@/lib/i18n/messages';
import { buildRootMetadata } from '@/lib/seo/root-metadata';
import { documentLocale } from '@/lib/sites/document-locale';
import { RootDocument } from './RootDocument';

/**
 * Root layout of the page engine routes (platform site `app/[locale]`, tenant sites
 * `app/tenant-site/[studioSlug]/[locale]`): language, messages and metadata defaults come from the URL's
 * locale, so nothing here reads cookies or headers and the pages can be cached (docs/SEO.md "ISR").
 */
export async function siteRootMetadata(urlLocale: string): Promise<Metadata> {
  const locale = await documentLocale(urlLocale);
  return buildRootMetadata(await getTFor(locale), locale);
}

export async function SiteRootLayout({ urlLocale, children }: { urlLocale: string; children: React.ReactNode }) {
  const locale = await documentLocale(urlLocale);
  const messages = await getLocaleMessages(locale);
  return (
    <RootDocument locale={locale} messages={messages}>
      {children}
    </RootDocument>
  );
}
