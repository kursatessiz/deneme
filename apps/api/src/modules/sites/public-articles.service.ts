import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  ARTICLE_FEED_LIMIT,
  DEFAULT_TENANT_THEME,
  PRODUCT_NAME,
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  articleSummary,
  articleTagLabel,
  buildArticleFeedXml,
  createTranslator,
  type ArticleSitemapEntry,
  type PublicArticleDTO,
  type PublicArticleListDTO,
  type PublicArticleSiteDTO,
  type PublicArticleSummaryDTO,
  type PublicArticleTagDTO,
  type PublicArticlesQuery,
  type TenantTheme,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { articleError } from './articles.errors';
import { ArticlesFeedCache } from './articles-feed-cache.service';
import { sitesBaseDomain } from './sites.service';
import { apiError } from '../../common/api-error';

const SITE_INCLUDE = { domains: { where: { status: 'VERIFIED' }, select: { domain: true } } } satisfies Prisma.SiteInclude;

interface ResolvedSite {
  studio: { id: string; slug: string; name: string; logoUrl: string | null; themeFamily: string; themePrimary: string; gradientPresetKey: string };
  site: Prisma.SiteGetPayload<{ include: typeof SITE_INCLUDE }>;
}

const LOCALE_INCLUDE = {
  article: { include: { tags: { include: { tag: { select: { slug: true, labels: true } } } } } },
} satisfies Prisma.ArticleLocaleInclude;
type LocaleRow = Prisma.ArticleLocaleGetPayload<{ include: typeof LOCALE_INCLUDE }>;

/** `https://<host>`; plain http only for the local development host (same rule as the web app's origin helper). */
function originForHost(host: string): string {
  return `${host === 'localhost' || host.startsWith('localhost:') ? 'http' : 'https'}://${host}`;
}

function laterIso(a: Date, b: Date): string {
  return (a > b ? a : b).toISOString();
}

/**
 * Unauthenticated reads of a site's published articles (S2b): lists, one
 * article, tags, sitemap entries and the RSS feed. Same slug-to-studio
 * resolution as the page engine's public endpoints (active studio with a
 * site); only PUBLISHED articles are ever returned.
 */
@Injectable()
export class PublicArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feedCache: ArticlesFeedCache,
  ) {}

  private async resolve(studioSlug: string): Promise<ResolvedSite> {
    const studio = await this.prisma.studio.findFirst({
      where: { slug: studioSlug, isActive: true },
      select: { id: true, slug: true, name: true, logoUrl: true, themeFamily: true, themePrimary: true, gradientPresetKey: true, site: { include: SITE_INCLUDE } },
    });
    if (!studio?.site) throw new NotFoundException(apiError('apiErrors.sites.siteNotFound'));
    const { site, ...rest } = studio;
    return { studio: rest, site };
  }

  private async siteInfo({ studio, site }: ResolvedSite): Promise<PublicArticleSiteDTO> {
    const isPlatform = site.kind === 'PLATFORM';
    const theme: TenantTheme = isPlatform
      ? DEFAULT_TENANT_THEME
      : {
          logoUrl: studio.logoUrl,
          themeFamily: studio.themeFamily as TenantTheme['themeFamily'],
          themePrimary: studio.themePrimary,
          gradientPresetKey: studio.gradientPresetKey as TenantTheme['gradientPresetKey'],
        };
    let publisherName = studio.name;
    if (isPlatform) {
      const company = await this.prisma.companyInfo.findUnique({ where: { id: 'platform' }, select: { legalName: true } });
      publisherName = company?.legalName ?? PRODUCT_NAME;
    }
    return {
      siteKind: site.kind,
      studioSlug: studio.slug,
      siteName: isPlatform ? PRODUCT_NAME : studio.name,
      publisherName,
      logoUrl: studio.logoUrl,
      defaultLocale: site.defaultLocale,
      enabledLocales: site.enabledLocales,
      theme,
    };
  }

  /** The site's canonical origin: platform domain, a verified primary custom domain, else `<slug>.<base>`. */
  private siteOrigin({ studio, site }: ResolvedSite): string {
    const base = sitesBaseDomain();
    if (site.kind === 'PLATFORM') return originForHost(base);
    if (site.primaryDomain && site.domains.some((d) => d.domain === site.primaryDomain)) return originForHost(site.primaryDomain);
    return originForHost(`${studio.slug}.${base}`);
  }

  private toSummary(row: LocaleRow, defaultLocale: string): PublicArticleSummaryDTO {
    return {
      locale: row.locale,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt ?? articleSummary(row.body),
      coverImageUrl: row.article.coverImageUrl,
      authorName: row.article.authorName,
      publishedAt: (row.article.publishedAt ?? row.article.createdAt).toISOString(),
      updatedAt: laterIso(row.article.updatedAt, row.updatedAt),
      readingMinutes: row.readingMinutes,
      tags: row.article.tags
        .map((link) => ({ slug: link.tag.slug, label: articleTagLabel({ slug: link.tag.slug, labels: (link.tag.labels ?? {}) as Record<string, string> }, row.locale, defaultLocale) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  private async publishedLocales(siteId: string): Promise<string[]> {
    const rows = await this.prisma.articleLocale.findMany({
      where: { siteId, article: { status: 'PUBLISHED' } },
      distinct: ['locale'],
      select: { locale: true },
      orderBy: { locale: 'asc' },
    });
    return rows.map((r) => r.locale);
  }

  async list(studioSlug: string, query: PublicArticlesQuery): Promise<PublicArticleListDTO> {
    const resolved = await this.resolve(studioSlug);
    const { site } = resolved;
    const publishedLocales = await this.publishedLocales(site.id);
    if (!site.enabledLocales.includes(query.locale) && !publishedLocales.includes(query.locale)) throw new NotFoundException(apiError('apiErrors.sites.localeNotFound'));

    let tag: PublicArticleTagDTO | null = null;
    let tagId: string | null = null;
    if (query.tag) {
      const row = await this.prisma.articleTag.findUnique({ where: { siteId_slug: { siteId: site.id, slug: query.tag } } });
      if (!row) throw articleError('ARTICLE_TAG_NOT_FOUND');
      tagId = row.id;
      tag = { slug: row.slug, label: articleTagLabel({ slug: row.slug, labels: (row.labels ?? {}) as Record<string, string> }, query.locale, site.defaultLocale) };
    }

    const where: Prisma.ArticleLocaleWhereInput = {
      siteId: site.id,
      locale: query.locale,
      article: { status: 'PUBLISHED', ...(tagId ? { tags: { some: { tagId } } } : {}) },
    };
    const [rows, total, info] = await Promise.all([
      this.prisma.articleLocale.findMany({
        where,
        include: LOCALE_INCLUDE,
        orderBy: [{ article: { publishedAt: 'desc' } }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.articleLocale.count({ where }),
      this.siteInfo(resolved),
    ]);
    return {
      site: info,
      locale: query.locale,
      tag,
      publishedLocales,
      items: rows.map((r) => this.toSummary(r, site.defaultLocale)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(studioSlug: string, locale: string, slug: string): Promise<PublicArticleDTO> {
    const resolved = await this.resolve(studioSlug);
    const row = await this.prisma.articleLocale.findFirst({
      where: { siteId: resolved.site.id, locale, slug, article: { status: 'PUBLISHED' } },
      include: { article: { include: { ...LOCALE_INCLUDE.article.include, locales: { select: { locale: true, slug: true }, orderBy: { locale: 'asc' } } } } },
    });
    if (!row) throw articleError('ARTICLE_NOT_FOUND');
    return {
      ...this.toSummary(row, resolved.site.defaultLocale),
      site: await this.siteInfo(resolved),
      body: row.body,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      ogImageUrl: row.ogImageUrl,
      alternates: row.article.locales.map((l) => ({ locale: l.locale, slug: l.slug })),
    };
  }

  /** Tags with at least one published article in `locale`, labelled in that locale. */
  async tags(studioSlug: string, locale: string): Promise<Array<PublicArticleTagDTO & { count: number }>> {
    const { site } = await this.resolve(studioSlug);
    const tags = await this.prisma.articleTag.findMany({
      where: { siteId: site.id },
      include: { _count: { select: { articles: { where: { article: { status: 'PUBLISHED', locales: { some: { locale } } } } } } } },
      orderBy: { slug: 'asc' },
    });
    return tags
      .filter((t) => t._count.articles > 0)
      .map((t) => ({ slug: t.slug, label: articleTagLabel({ slug: t.slug, labels: (t.labels ?? {}) as Record<string, string> }, locale, site.defaultLocale), count: t._count.articles }));
  }

  /** Every published locale variant, for sitemap.xml. Empty for an unknown studio or one without a site. */
  async sitemapEntries(studioSlug: string): Promise<ArticleSitemapEntry[]> {
    const studio = await this.prisma.studio.findFirst({ where: { slug: studioSlug, isActive: true }, select: { site: { select: { id: true } } } });
    if (!studio?.site) return [];
    const rows = await this.prisma.articleLocale.findMany({
      where: { siteId: studio.site.id, article: { status: 'PUBLISHED' } },
      select: { locale: true, slug: true, updatedAt: true, article: { select: { id: true, updatedAt: true } } },
      orderBy: [{ articleId: 'asc' }, { locale: 'asc' }],
    });
    return rows.map((r) => ({ articleId: r.article.id, locale: r.locale, slug: r.slug, updatedAt: laterIso(r.article.updatedAt, r.updatedAt) }));
  }

  /** RSS 2.0 feed of the newest published articles in `locale`, cached per site and locale. */
  async feed(studioSlug: string, locale: string): Promise<string> {
    const resolved = await this.resolve(studioSlug);
    const cached = this.feedCache.get(resolved.site.id, locale);
    if (cached) return cached;
    const list = await this.list(studioSlug, { locale, page: 1, pageSize: ARTICLE_FEED_LIMIT });
    const messages = BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES;
    const t = createTranslator({ locale, messages, fallback: BASE_MESSAGES });
    const xml = buildArticleFeedXml(list, this.siteOrigin(resolved), {
      title: t('articles.public.feedTitle', { site: list.site.siteName }),
      description: t('articles.public.description', { site: list.site.siteName }),
    });
    this.feedCache.set(resolved.site.id, locale, xml);
    return xml;
  }
}
