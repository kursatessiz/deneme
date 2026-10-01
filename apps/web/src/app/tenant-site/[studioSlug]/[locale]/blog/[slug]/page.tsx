import type { Metadata } from 'next';
import { ArticleView, buildArticleMetadata } from '@/components/sites/BlogPages';

/** One published article of the tenant site (`/<locale>/blog...` on the tenant host). Unpublished or unknown is a 404. Cached with ISR (docs/SEO.md "ISR"). */
export const revalidate = 300;

export function generateStaticParams(): Array<{ studioSlug: string; locale: string; slug: string }> {
  return [];
}

type Props = { params: Promise<{ studioSlug: string; locale: string; slug: string }> };

export default async function TenantArticlePage({ params }: Props) {
  const { studioSlug, locale, slug } = await params;
  return <ArticleView studioSlug={studioSlug} isPlatform={false} locale={locale} slug={slug} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, locale, slug } = await params;
  return buildArticleMetadata({ studioSlug: studioSlug, isPlatform: false, locale }, slug);
}
