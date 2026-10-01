import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  articlePath,
  blogFeedPath,
  blogIndexPath,
  blogTagPath,
  buildHreflangAlternates,
  type PublicArticleSiteDTO,
  type PublicArticleSummaryDTO,
  type Translate,
} from '@platform/shared';
import { Badge, Card, CardContent, LinkButton } from '@/components/ui';
import { getTFor } from '@/lib/i18n/getT';
import { toOgLocale } from '@/lib/seo/og-locale';
import { fetchPublicArticle, fetchPublicArticles } from '@/lib/sites/articles-api';
import { serializeJsonLd } from '@/lib/sites/json-ld';
import { articleJsonLd, breadcrumbJsonLd } from '@/lib/sites/jsonld';
import { sitePath } from '@/lib/sites/origin';
import { ArticleBody } from './ArticleBody';
import { fetchSiteSettings } from '@/lib/sites/api';
import { SiteShell, poweredByOf } from './SiteShell';

/**
 * Blog pages of the page engine (S2b, docs/SAYFA_MOTORU.md "Yazılar / blog"): the article list (optionally
 * filtered by tag) and one article, shared by the platform routes (`/[locale]/blog/...`) and the tenant routes
 * (`tenant-site/[studioSlug]/[locale]/blog/...`). Server rendered in the site's shell and theme; titles, bodies
 * and tag labels are tenant data and are never translated.
 */

export interface BlogRouteParams {
  studioSlug: string;
  isPlatform: boolean;
  locale: string;
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function feedAlternate(origin: string, locale: string, site: PublicArticleSiteDTO, t: Translate) {
  return { 'application/rss+xml': [{ url: `${origin}${blogFeedPath(locale)}`, title: t('articles.public.feedTitle', { site: site.siteName }) }] };
}

/** The blog's own header: the site name back to its home page, and the blog index. */
function BlogHeader({ site, locale, t }: { site: PublicArticleSiteDTO; locale: string; t: Translate }) {
  return (
    <header className="ui-rule px-4 py-3">
      <nav className="mx-auto max-w-3xl flex flex-wrap items-center justify-between gap-3" aria-label={site.siteName}>
        <Link href={sitePath(locale, '')} className="pui-link ui-strong">
          {site.siteName}
        </Link>
        <Link href={blogIndexPath(locale)} className="pui-link">
          {t('articles.public.title')}
        </Link>
      </nav>
    </header>
  );
}

function ArticleMeta({ article, locale, t }: { article: PublicArticleSummaryDTO; locale: string; t: Translate }) {
  return (
    <p className="ui-caption ui-text-muted">
      {t('articles.public.byline', { author: article.authorName, date: formatDate(article.publishedAt, locale) })}
      {' · '}
      {t('articles.public.readingMinutes', { count: article.readingMinutes })}
    </p>
  );
}

function TagBadges({ tags, locale }: { tags: PublicArticleSummaryDTO['tags']; locale: string }) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag.slug}>
          <Link href={blogTagPath(locale, tag.slug)} className="pui-link">
            <Badge tone="theme">{tag.label}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Blog index (and tag listing)
// ---------------------------------------------------------------------------

export async function buildBlogIndexMetadata({ studioSlug, locale }: BlogRouteParams, page: number, tag?: string): Promise<Metadata> {
  const list = await fetchPublicArticles(studioSlug, locale, { page, tag });
  if (!list) return {};
  const [t, settings] = await Promise.all([getTFor(locale), fetchSiteSettings(studioSlug)]);
  const origin = settings.canonicalOrigin;
  const site = list.site;
  const heading = list.tag ? t('articles.public.tagTitle', { tag: list.tag.label }) : t('articles.public.title');
  const title = t('articles.public.metaTitle', { title: heading, site: site.siteName });
  const description = list.tag ? t('articles.public.tagDescription', { tag: list.tag.label, site: site.siteName }) : t('articles.public.description', { site: site.siteName });
  const pathFor = (l: string) => (list.tag ? blogTagPath(l, list.tag.slug) : blogIndexPath(l));
  const url = `${origin}${pathFor(locale)}${page > 1 ? `?page=${page}` : ''}`;
  // Only the first page carries the locale alternates; later pages are canonical to themselves.
  const languages =
    page === 1 ? buildHreflangAlternates(list.publishedLocales.map((l) => ({ locale: l, slug: '' })), (l) => `${origin}${pathFor(l)}`, site.defaultLocale) : undefined;

  return {
    title,
    description,
    alternates: { canonical: url, ...(languages ? { languages } : {}), types: feedAlternate(origin, locale, site, t) },
    // An empty listing is not worth indexing.
    ...(list.items.length === 0 ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: 'website', siteName: site.siteName, locale: toOgLocale(locale), title, description, url },
    twitter: { card: 'summary', title, description },
  };
}

export async function BlogIndexView({ studioSlug, locale, page, tag }: BlogRouteParams & { page: number; tag?: string }) {
  const list = await fetchPublicArticles(studioSlug, locale, { page, tag });
  if (!list) notFound();
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  if (page > pages) notFound();
  const [t, settings] = await Promise.all([getTFor(locale), fetchSiteSettings(studioSlug)]);
  const origin = settings.canonicalOrigin;
  const { site } = list;
  const heading = list.tag ? t('articles.public.tagTitle', { tag: list.tag.label }) : t('articles.public.title');
  const listPath = list.tag ? blogTagPath(locale, list.tag.slug) : blogIndexPath(locale);
  const pageHref = (n: number) => (n > 1 ? `${listPath}?page=${n}` : listPath);

  const crumbs = [
    { name: site.siteName, url: `${origin}${sitePath(locale, '')}` },
    { name: t('articles.public.title'), url: `${origin}${blogIndexPath(locale)}` },
    ...(list.tag ? [{ name: list.tag.label, url: `${origin}${listPath}` }] : []),
  ];

  return (
    <SiteShell theme={site.theme} studioSlug={studioSlug} cookieLabel={t('sites.footer.cookiePreferences')} jsonLd={[serializeJsonLd(breadcrumbJsonLd(crumbs))]} poweredBy={poweredByOf(settings, t)}>
      <BlogHeader site={site} locale={locale} t={t} />
      <div className="mx-auto max-w-3xl px-4 py-10 grid gap-8">
        <div className="grid gap-2">
          <h1 className="ui-display">{heading}</h1>
          <a href={blogFeedPath(locale)} className="pui-link ui-caption justify-self-start" data-testid="blog-feed-link">
            {t('articles.public.feed')}
          </a>
        </div>

        {list.items.length === 0 ? (
          <p className="ui-text-muted">{t('articles.public.empty')}</p>
        ) : (
          <ul className="grid gap-4">
            {list.items.map((article) => (
              <li key={article.slug}>
                <Card as="article" data-testid="blog-article-card">
                  {article.coverImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={article.coverImageUrl} alt={t('articles.public.cover', { title: article.title })} width={1200} height={630} decoding="async" loading="lazy" className="w-full h-auto object-cover" />
                  )}
                  <CardContent>
                    <h2 className="ui-title">
                      <Link href={articlePath(locale, article.slug)} className="pui-link">
                        {article.title}
                      </Link>
                    </h2>
                    <ArticleMeta article={article} locale={locale} t={t} />
                    <p className="ui-text-muted">{article.excerpt}</p>
                    <TagBadges tags={article.tags} locale={locale} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav className="flex flex-wrap items-center justify-between gap-3" aria-label={t('articles.public.pagination')}>
            {page > 1 ? (
              <LinkButton href={pageHref(page - 1)} variant="outline" tone="surface" rel="prev">
                {t('articles.public.previous')}
              </LinkButton>
            ) : (
              <span />
            )}
            <span className="ui-caption">{t('articles.public.pageOf', { page, pages })}</span>
            {page < pages ? (
              <LinkButton href={pageHref(page + 1)} variant="outline" tone="surface" rel="next">
                {t('articles.public.next')}
              </LinkButton>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </SiteShell>
  );
}

// ---------------------------------------------------------------------------
// One article
// ---------------------------------------------------------------------------

export async function buildArticleMetadata({ studioSlug, locale }: BlogRouteParams, slug: string): Promise<Metadata> {
  const article = await fetchPublicArticle(studioSlug, locale, slug);
  if (!article) return {};
  const [t, settings] = await Promise.all([getTFor(locale), fetchSiteSettings(studioSlug)]);
  const origin = settings.canonicalOrigin;
  const { site } = article;
  const title = article.seoTitle ?? t('articles.public.metaTitle', { title: article.title, site: site.siteName });
  const description = article.seoDescription ?? article.excerpt;
  const url = `${origin}${articlePath(locale, article.slug)}`;
  const languages = buildHreflangAlternates(article.alternates, (l, s) => `${origin}${articlePath(l, s)}`, site.defaultLocale);
  const imageUrl = article.ogImageUrl ?? article.coverImageUrl;
  const ogImage = imageUrl
    ? { url: imageUrl, alt: article.title }
    : { url: `${origin}/og?${new URLSearchParams({ locale, article: article.slug }).toString()}`, width: 1200, height: 630, alt: article.title };

  return {
    title,
    description,
    alternates: { canonical: url, languages, types: feedAlternate(origin, locale, site, t) },
    openGraph: {
      type: 'article',
      siteName: site.siteName,
      locale: toOgLocale(locale),
      alternateLocale: article.alternates.filter((a) => a.locale !== locale).map((a) => toOgLocale(a.locale)),
      title,
      description,
      url,
      images: [ogImage],
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      authors: [article.authorName],
      tags: article.tags.map((tag) => tag.label),
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage.url] },
  };
}

export async function ArticleView({ studioSlug, locale, slug }: BlogRouteParams & { slug: string }) {
  const article = await fetchPublicArticle(studioSlug, locale, slug);
  if (!article) notFound();
  const [t, settings] = await Promise.all([getTFor(locale), fetchSiteSettings(studioSlug)]);
  const origin = settings.canonicalOrigin;
  const { site } = article;
  const url = `${origin}${articlePath(locale, article.slug)}`;
  const updated = article.updatedAt.slice(0, 10) !== article.publishedAt.slice(0, 10);

  const jsonLd = [
    articleJsonLd({
      headline: article.title,
      url,
      description: article.seoDescription ?? article.excerpt,
      imageUrl: article.ogImageUrl ?? article.coverImageUrl ?? site.logoUrl,
      datePublished: article.publishedAt,
      dateModified: article.updatedAt,
      locale,
      // A byline equal to the site or publisher name is the organization itself, not a person.
      author: { name: article.authorName, kind: article.authorName === site.siteName || article.authorName === site.publisherName ? 'Organization' : 'Person' },
      publisher: { name: site.publisherName, url: origin, logoUrl: site.logoUrl },
    }),
    breadcrumbJsonLd([
      { name: site.siteName, url: `${origin}${sitePath(locale, '')}` },
      { name: t('articles.public.title'), url: `${origin}${blogIndexPath(locale)}` },
      { name: article.title, url },
    ]),
  ];

  return (
    <SiteShell theme={site.theme} studioSlug={studioSlug} cookieLabel={t('sites.footer.cookiePreferences')} jsonLd={jsonLd.map((doc) => serializeJsonLd(doc))} poweredBy={poweredByOf(settings, t)}>
      <BlogHeader site={site} locale={locale} t={t} />
      <article className="mx-auto max-w-3xl px-4 py-10 grid gap-6">
        <Link href={blogIndexPath(locale)} className="pui-link ui-caption justify-self-start">
          {t('articles.public.backToBlog')}
        </Link>
        <header className="grid gap-2">
          <h1 className="ui-display">{article.title}</h1>
          <ArticleMeta article={article} locale={locale} t={t} />
          {updated && <p className="ui-caption ui-text-muted">{t('articles.public.updated', { date: formatDate(article.updatedAt, locale) })}</p>}
        </header>
        {article.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={article.coverImageUrl} alt={t('articles.public.cover', { title: article.title })} width={1200} height={630} decoding="async" className="w-full h-auto object-cover" />
        )}
        <ArticleBody body={article.body} />
        {article.tags.length > 0 && (
          <section className="grid gap-2 ui-rule pt-4" aria-label={t('articles.public.tags')}>
            <TagBadges tags={article.tags} locale={locale} />
          </section>
        )}
      </article>
    </SiteShell>
  );
}
