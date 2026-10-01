import type { Metadata } from 'next';
import { SitePageView, buildSiteMetadata } from '@/components/sites/SitePage';

/**
 * Cached with ISR (docs/SEO.md "ISR"): rendered on first request, then served from the cache for up to 300
 * seconds and purged on publish (POST /api/revalidate, tag `site:<slug>`). Nothing here reads cookies or
 * headers; a page whose blocks carry A/B variants reads the visitor's cookies and so renders per request.
 */
export const revalidate = 300;

/** No page is generated at build time: the first request of each path fills the cache. */
export function generateStaticParams(): Array<{ locale: string; slug: string[] }> {
  return [];
}

/**
 * Platform site: `/tr`, `/en` (home), `/tr/pilates` (sector landing),
 * `/tr/pilates/ucretsiz-deneme` (campaign offer variant), `/tr/hakkimizda`
 * (corporate/legal). One route renders all of it: the slug maps 1:1 to the
 * published PageLocale.slug (docs/SAYFA_MOTORU.md, section 5). Only
 * published pages render; an unknown locale or slug is a 404.
 */
export default async function PlatformSitePage({ params }: { params: Promise<{ locale: string; slug?: string[] }> }) {
  const { locale, slug } = await params;
  return <SitePageView studioSlug="platform" isPlatform locale={locale} slugParts={slug} />;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug?: string[] }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  return buildSiteMetadata('platform', true, locale, slug);
}
