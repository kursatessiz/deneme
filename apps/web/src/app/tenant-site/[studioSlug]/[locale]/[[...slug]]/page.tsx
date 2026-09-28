import type { Metadata } from 'next';
import { SitePageView, buildSiteMetadata } from '@/components/sites/SitePage';

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
