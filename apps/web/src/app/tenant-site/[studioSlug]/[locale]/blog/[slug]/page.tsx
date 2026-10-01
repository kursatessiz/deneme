import type { Metadata } from 'next';
import { ArticleView, buildArticleMetadata } from '@/components/sites/BlogPages';

/** One published article of a tenant site (S2b): `/<locale>/blog/<slug>` on the tenant host. */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ studioSlug: string; locale: string; slug: string }> };

export default async function TenantArticlePage({ params }: Props) {
  const { studioSlug, locale, slug } = await params;
  return <ArticleView studioSlug={studioSlug} isPlatform={false} locale={locale} slug={slug} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, locale, slug } = await params;
  return buildArticleMetadata({ studioSlug, isPlatform: false, locale }, slug);
}
