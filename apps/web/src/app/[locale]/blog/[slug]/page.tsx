import type { Metadata } from 'next';
import { ArticleView, buildArticleMetadata } from '@/components/sites/BlogPages';

/** One published platform article (S2b): `/tr/blog/<slug>`. Unpublished or unknown is a 404. */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; slug: string }> };

export default async function PlatformArticlePage({ params }: Props) {
  const { locale, slug } = await params;
  return <ArticleView studioSlug="platform" isPlatform locale={locale} slug={slug} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  return buildArticleMetadata({ studioSlug: 'platform', isPlatform: true, locale }, slug);
}
