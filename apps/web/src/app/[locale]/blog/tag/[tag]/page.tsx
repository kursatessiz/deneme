import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';
import { parsePageParam } from '@/lib/sites/articles-api';

/** Platform articles with one tag (S2b): `/tr/blog/tag/<tag>`. An unknown tag is a 404. */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; tag: string }>; searchParams: Promise<{ page?: string | string[] }> };

export default async function PlatformBlogTagPage({ params, searchParams }: Props) {
  const [{ locale, tag }, query] = await Promise.all([params, searchParams]);
  return <BlogIndexView studioSlug="platform" isPlatform locale={locale} page={parsePageParam(query.page)} tag={tag} />;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ locale, tag }, query] = await Promise.all([params, searchParams]);
  return buildBlogIndexMetadata({ studioSlug: 'platform', isPlatform: true, locale }, parsePageParam(query.page), tag);
}
