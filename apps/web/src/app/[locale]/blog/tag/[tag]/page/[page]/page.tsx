import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';
import { parseListPage } from '@/lib/sites/blog-paging';

/** Platform articles with one tag, page 2 and later: the cached target of the middleware's `?page=N` rewrite. */
export const revalidate = 300;

export function generateStaticParams(): Array<{ locale: string; tag: string; page: string }> {
  return [];
}

type Props = { params: Promise<{ locale: string; tag: string; page: string }> };

export default async function PlatformBlogTagPagedPage({ params }: Props) {
  const { locale, tag, page } = await params;
  const n = parseListPage(page);
  if (!n) notFound();
  return <BlogIndexView studioSlug={'platform'} isPlatform locale={locale} page={n} tag={tag} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, tag, page } = await params;
  const n = parseListPage(page);
  if (!n) return {};
  return buildBlogIndexMetadata({ studioSlug: 'platform', isPlatform: true, locale }, n, tag);
}
