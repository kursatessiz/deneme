import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';
import { parsePageParam } from '@/lib/sites/articles-api';

/**
 * Platform site blog index (S2b): `/tr/blog`, `/en/blog?page=2`. The static `blog` segment takes precedence
 * over the page engine's optional catch-all (`[[...slug]]`), and page slugs may not start with `blog`
 * (UpsertPageLocaleSchema), so no page engine page can be shadowed. Rendered per request like the page engine.
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string | string[] }> };

export default async function PlatformBlogPage({ params, searchParams }: Props) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  return <BlogIndexView studioSlug="platform" isPlatform locale={locale} page={parsePageParam(query.page)} />;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  return buildBlogIndexMetadata({ studioSlug: 'platform', isPlatform: true, locale }, parsePageParam(query.page));
}
