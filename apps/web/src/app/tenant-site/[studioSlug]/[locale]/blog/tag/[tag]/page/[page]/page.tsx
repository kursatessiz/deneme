import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';
import { parseListPage } from '@/lib/sites/blog-paging';

/** Tenant articles with one tag, page 2 and later: the cached target of the middleware's `?page=N` rewrite. */
export const revalidate = 300;

export function generateStaticParams(): Array<{ studioSlug: string; locale: string; tag: string; page: string }> {
  return [];
}

type Props = { params: Promise<{ studioSlug: string; locale: string; tag: string; page: string }> };

export default async function TenantBlogTagPagedPage({ params }: Props) {
  const { studioSlug, locale, tag, page } = await params;
  const n = parseListPage(page);
  if (!n) notFound();
  return <BlogIndexView studioSlug={studioSlug} isPlatform={false} locale={locale} page={n} tag={tag} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, locale, tag, page } = await params;
  const n = parseListPage(page);
  if (!n) return {};
  return buildBlogIndexMetadata({ studioSlug: studioSlug, isPlatform: false, locale }, n, tag);
}
