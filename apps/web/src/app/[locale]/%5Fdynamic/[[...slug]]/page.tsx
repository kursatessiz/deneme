import type { Metadata } from 'next';
import { SitePageView, buildSiteMetadata } from '@/components/sites/SitePage';

/**
 * Per-request twin of `[[...slug]]` for pages whose blocks carry A/B variants: the middleware rewrites those
 * paths here (`/tr/ab-deneme` -> `/tr/_dynamic/ab-deneme`), the visitor's URL does not change. It reads the
 * visitor's cookies to pick a variant, so it is never cached; the trade-off is one render per request for
 * those pages only (docs/SEO.md "ISR"). Page slugs cannot contain an underscore, so no page is shadowed.
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; slug?: string[] }> };

export default async function PlatformDynamicSitePage({ params }: Props) {
  const { locale, slug } = await params;
  return <SitePageView studioSlug="platform" isPlatform locale={locale} slugParts={slug} perRequest />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  return buildSiteMetadata('platform', true, locale, slug);
}
