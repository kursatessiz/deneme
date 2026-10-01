import { headers } from 'next/headers';
import { LocaleCodeSchema, PRODUCT_NAME } from '@platform/shared';
import { fetchPublicPage, studioSlugForHost } from '@/lib/sites/api';
import { fetchPublicArticle } from '@/lib/sites/articles-api';
import { fetchLogoDataUri } from '@/lib/og/logo';
import { renderOgCard } from '@/lib/og/card';

/**
 * Generated Open Graph image of a page-engine page (`?locale=&slug=`) or of a blog article without its own
 * image (`?locale=&article=`); host-aware like sitemap.xml (docs/SEO.md).
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,199}$/;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const locale = LocaleCodeSchema.safeParse(params.get('locale'));
  const slug = params.get('slug') ?? '';
  if (!locale.success || (slug !== '' && !SLUG_PATTERN.test(slug))) return new Response(null, { status: 400 });

  const h = await headers();
  const { studioSlug, isPlatform } = await studioSlugForHost(h.get('host') ?? '');

  const articleSlug = params.get('article');
  if (articleSlug !== null) {
    const article = await fetchPublicArticle(studioSlug, locale.data, articleSlug);
    if (!article) return new Response(null, { status: 404 });
    return renderOgCard({
      title: article.title,
      description: article.excerpt,
      name: article.site.siteName,
      primary: article.site.theme.themePrimary,
      logoDataUri: await fetchLogoDataUri(article.site.logoUrl),
    });
  }

  const page = await fetchPublicPage(studioSlug, locale.data, slug);
  if (!page) return new Response(null, { status: 404 });

  const name = isPlatform ? PRODUCT_NAME : (page.context.studioContact?.name ?? page.context.companyInfo?.legalName ?? null);
  return renderOgCard({
    title: page.localeMeta.seoTitle ?? name ?? PRODUCT_NAME,
    description: page.localeMeta.seoDescription,
    name,
    primary: page.theme.themePrimary,
    logoDataUri: await fetchLogoDataUri(page.theme.logoUrl),
  });
}
