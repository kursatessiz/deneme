import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';

/**
 * Platform blog index, page 1 (S2b). Later pages are `blog/page/[page]`: the middleware rewrites `?page=N` to it, so
 * this route never reads `searchParams` and can be cached. The static `blog` segment takes precedence over the
 * page engine's optional catch-all, and page slugs may not start with `blog` (UpsertPageLocaleSchema).
 * Cached with ISR (docs/SEO.md "ISR"), purged on publish through POST /api/revalidate (tag `site:<slug>`).
 */
export const revalidate = 300;

export function generateStaticParams(): Array<{ locale: string }> {
  return [];
}

type Props = { params: Promise<{ locale: string }> };

export default async function PlatformBlogPage({ params }: Props) {
  const { locale } = await params;
  return <BlogIndexView studioSlug={'platform'} isPlatform locale={locale} page={1} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return buildBlogIndexMetadata({ studioSlug: 'platform', isPlatform: true, locale }, 1);
}
