import type { Metadata } from 'next';
import { SitePageView, buildSiteMetadata } from '@/components/sites/SitePage';

/**
 * Cached with ISR like the platform site (docs/SEO.md "ISR"). The cache key is the rewritten path, which holds the
 * studio slug (`/tenant-site/<studioSlug>/...`), so two tenants never share an entry whatever host served them.
 */
export const revalidate = 300;

/** No page is generated at build time: the first request of each path fills the cache. */
export function generateStaticParams(): Array<{ studioSlug: string; locale: string; slug: string[] }> {
  return [];
}

/**
 * A tenant's own site, reached through `middleware.ts` rewriting
 * `<slug>.<platform-domain>` or a verified custom domain here
 * (docs/SAYFA_MOTORU.md). Same rendering as the platform site, scoped to
 * one studio's published pages.
 */
export default async function TenantSitePage({ params }: { params: Promise<{ studioSlug: string; locale: string; slug?: string[] }> }) {
  const { studioSlug, locale, slug } = await params;
  return <SitePageView studioSlug={studioSlug} isPlatform={false} locale={locale} slugParts={slug} />;
}

export async function generateMetadata({ params }: { params: Promise<{ studioSlug: string; locale: string; slug?: string[] }> }): Promise<Metadata> {
  const { studioSlug, locale, slug } = await params;
  return buildSiteMetadata(studioSlug, false, locale, slug);
}
