import type { Metadata } from 'next';
import { ArticleView, buildArticleMetadata } from '@/components/sites/BlogPages';

/** One published article of the platform site (`/<locale>/blog...`). Unpublished or unknown is a 404. Cached with ISR (docs/SEO.md "ISR"). */
export const revalidate = 300;

export function generateStaticParams(): Array<{ locale: string; slug: string }> {
  return [];
}

type Props = { params: Promise<{ locale: string; slug: string }> };

export default async function PlatformArticlePage({ params }: Props) {
  const { locale, slug } = await params;
  return <ArticleView studioSlug={'platform'} isPlatform locale={locale} slug={slug} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  return buildArticleMetadata({ studioSlug: 'platform', isPlatform: true, locale }, slug);
}
