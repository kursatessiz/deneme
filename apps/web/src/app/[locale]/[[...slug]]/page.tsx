import type { Metadata } from 'next';
import { SitePageView, buildSiteMetadata } from '@/components/sites/SitePage';
import { fetchSitemapEntries } from '@/lib/sites/api';

export const revalidate = 300;

export async function generateStaticParams() {
  const entries = await fetchSitemapEntries('platform');
  return entries.map((e) => ({ locale: e.locale, slug: e.slug ? e.slug.split('/') : [] }));
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
