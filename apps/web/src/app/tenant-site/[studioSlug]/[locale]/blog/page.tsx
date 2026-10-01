import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';

/**
 * Tenant blog index, page 1 (S2b). Later pages are `blog/page/[page]`: the middleware rewrites `?page=N` to it, so
 * this route never reads `searchParams` and can be cached. The static `blog` segment takes precedence over the
 * page engine's optional catch-all, and page slugs may not start with `blog` (UpsertPageLocaleSchema).
 * Cached with ISR (docs/SEO.md "ISR"), purged on publish through POST /api/revalidate (tag `site:<slug>`).
 */
export const revalidate = 300;

export function generateStaticParams(): Array<{ studioSlug: string; locale: string }> {
  return [];
}

type Props = { params: Promise<{ studioSlug: string; locale: string }> };

export default async function TenantBlogPage({ params }: Props) {
  const { studioSlug, locale } = await params;
  return <BlogIndexView studioSlug={studioSlug} isPlatform={false} locale={locale} page={1} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, locale } = await params;
  return buildBlogIndexMetadata({ studioSlug: studioSlug, isPlatform: false, locale }, 1);
}
