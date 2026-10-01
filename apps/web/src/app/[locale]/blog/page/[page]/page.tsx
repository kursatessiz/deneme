import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';
import { parseListPage } from '@/lib/sites/blog-paging';

/** Platform blog index, page 2 and later: the cached target of the middleware's `?page=N` rewrite. */
export const revalidate = 300;

export function generateStaticParams(): Array<{ locale: string; page: string }> {
  return [];
}

type Props = { params: Promise<{ locale: string; page: string }> };

export default async function PlatformBlogPagedPage({ params }: Props) {
  const { locale, page } = await params;
  const n = parseListPage(page);
  if (!n) notFound();
  return <BlogIndexView studioSlug={'platform'} isPlatform locale={locale} page={n} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, page } = await params;
  const n = parseListPage(page);
  if (!n) return {};
  return buildBlogIndexMetadata({ studioSlug: 'platform', isPlatform: true, locale }, n);
}
