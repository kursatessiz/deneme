import type { Metadata } from 'next';
import { BlogIndexView, buildBlogIndexMetadata } from '@/components/sites/BlogPages';

/** Tenant articles with one tag, page 1; later pages are `blog/tag/[tag]/page/[page]` (middleware rewrite of `?page=N`). An unknown tag is a 404. Cached with ISR (docs/SEO.md "ISR"). */
export const revalidate = 300;

export function generateStaticParams(): Array<{ studioSlug: string; locale: string; tag: string }> {
  return [];
}

type Props = { params: Promise<{ studioSlug: string; locale: string; tag: string }> };

export default async function TenantBlogTagPage({ params }: Props) {
  const { studioSlug, locale, tag } = await params;
  return <BlogIndexView studioSlug={studioSlug} isPlatform={false} locale={locale} page={1} tag={tag} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, locale, tag } = await params;
  return buildBlogIndexMetadata({ studioSlug: studioSlug, isPlatform: false, locale }, 1, tag);
}
