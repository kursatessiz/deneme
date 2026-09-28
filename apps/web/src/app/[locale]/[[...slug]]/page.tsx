import type { Metadata } from 'next';
import { SitePageView, buildSiteMetadata } from '@/components/sites/SitePage';

/**
 * Rendered per request: the root layout reads the locale header and cookies,
 * and the A/B variant is cookie-sticky. The API responses are still cached
 * (fetch revalidate + publish tags in lib/sites/api.ts), so a request costs
 * one render, not one API round trip.
 */
export const dynamic = 'force-dynamic';

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
