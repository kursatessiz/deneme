import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';

/** Platform articles with one tag, page 1; later pages are `blog/tag/[tag]/page/[page]` (middleware rewrite of `?page=N`). An unknown tag is a 404. Cached with ISR (docs/SEO.md "ISR"). */
export const revalidate = 300;

export function generateStaticParams(): Array<{ locale: string; tag: string }> {
  return [];
}

type Props = { params: Promise<{ locale: string; tag: string }> };

export default async function PlatformBlogTagPage({ params }: Props) {
  const { locale, tag } = await params;
  return <BlogIndexView studioSlug={'platform'} isPlatform locale={locale} page={1} tag={tag} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, tag } = await params;
  return buildBlogIndexMetadata({ studioSlug: 'platform', isPlatform: true, locale }, 1, tag);
}
