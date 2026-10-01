import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';
import { parsePageParam } from '@/lib/sites/articles-api';

/** A tenant site's articles with one tag (S2b): `/<locale>/blog/tag/<tag>` on the tenant host. */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ studioSlug: string; locale: string; tag: string }>; searchParams: Promise<{ page?: string | string[] }> };

export default async function TenantBlogTagPage({ params, searchParams }: Props) {
  const [{ studioSlug, locale, tag }, query] = await Promise.all([params, searchParams]);
  return <BlogIndexView studioSlug={studioSlug} isPlatform={false} locale={locale} page={parsePageParam(query.page)} tag={tag} />;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ studioSlug, locale, tag }, query] = await Promise.all([params, searchParams]);
  return buildBlogIndexMetadata({ studioSlug, isPlatform: false, locale }, parsePageParam(query.page), tag);
}
