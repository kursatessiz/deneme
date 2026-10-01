import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';
import { parsePageParam } from '@/lib/sites/articles-api';

/**
 * A tenant site's blog index (S2b), reached as `/<locale>/blog` on the tenant host through the middleware
 * rewrite. The static `blog` segment takes precedence over the page engine's `[[...slug]]` catch-all.
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ studioSlug: string; locale: string }>; searchParams: Promise<{ page?: string | string[] }> };

export default async function TenantBlogPage({ params, searchParams }: Props) {
  const [{ studioSlug, locale }, query] = await Promise.all([params, searchParams]);
  return <BlogIndexView studioSlug={studioSlug} isPlatform={false} locale={locale} page={parsePageParam(query.page)} />;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ studioSlug, locale }, query] = await Promise.all([params, searchParams]);
  return buildBlogIndexMetadata({ studioSlug, isPlatform: false, locale }, parsePageParam(query.page));
}
