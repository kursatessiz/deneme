import type { Metadata } from 'next';
import { SitePageView, buildSiteMetadata } from '@/components/sites/SitePage';

/** Per-request twin of a tenant site's `[[...slug]]` page for A/B pages (see `[locale]/_dynamic`, docs/SEO.md "ISR"). */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ studioSlug: string; locale: string; slug?: string[] }> };

export default async function TenantDynamicSitePage({ params }: Props) {
  const { studioSlug, locale, slug } = await params;
  return <SitePageView studioSlug={studioSlug} isPlatform={false} locale={locale} slugParts={slug} perRequest />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, locale, slug } = await params;
  return buildSiteMetadata(studioSlug, false, locale, slug);
}
