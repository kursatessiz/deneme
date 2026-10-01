import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@platform/shared';
import type { Translate } from '@platform/shared';
import { siteOrigin } from '@/lib/sites/origin';
import { toOgLocale } from '@/lib/seo/og-locale';

/**
 * Site-wide metadata defaults (docs/SEO.md), shared by every root layout. A route that sets its own
 * `openGraph` replaces this object (Next.js merges metadata shallowly), so such routes repeat `type`,
 * `siteName` and `locale`; `alternates` is never set here.
 */
export function buildRootMetadata(t: Translate, locale: string): Metadata {
  const title = t('seo.root.title', { product: PRODUCT_NAME });
  const description = t('seo.root.description');
  return {
    metadataBase: new URL(siteOrigin('platform', true)),
    title,
    description,
    applicationName: PRODUCT_NAME,
    openGraph: { type: 'website', siteName: PRODUCT_NAME, locale: toOgLocale(locale), title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}
