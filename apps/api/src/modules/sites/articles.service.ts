import { Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  computeReadingMinutes,
  type ArticleDTO,
  type ArticleLocaleInput,
  type ArticleTagDTO,
  type CreateArticleInput,
  type ListArticlesQuery,
  type PaginatedDTO,
  type UpdateArticleInput,
  type UpsertArticleTagInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SitesService } from './sites.service';
import { articleError } from './articles.errors';
import { ArticlesFeedCache } from './articles-feed-cache.service';
import { SiteCacheService } from './site-cache.service';
import { IndexNowService } from './indexnow/indexnow.service';

const ARTICLE_INCLUDE = { locales: { orderBy: { locale: 'asc' } }, tags: { select: { tagId: true } } } satisfies Prisma.ArticleInclude;
type ArticleRow = Prisma.ArticleGetPayload<{ include: typeof ARTICLE_INCLUDE }>;

function toArticleDto(article: ArticleRow): ArticleDTO {
  return {
    id: article.id,
    status: article.status,
    authorName: article.authorName,
    authorUserId: article.authorUserId,
    coverImageUrl: article.coverImageUrl,
    publishedAt: article.publishedAt?.toISOString() ?? null,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
    tagIds: article.tags.map((t) => t.tagId),
    locales: article.locales.map((l) => ({
      locale: l.locale,
      slug: l.slug,
      title: l.title,
      excerpt: l.excerpt,
      body: l.body,
      seoTitle: l.seoTitle,
      seoDescription: l.seoDescription,
      ogImageUrl: l.ogImageUrl,
      readingMinutes: l.readingMinutes,
    })),
  };
}

function localeData(input: ArticleLocaleInput) {
  return {
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    body: input.body,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    ogImageUrl: input.ogImageUrl,
    readingMinutes: computeReadingMinutes(input.body),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Article and tag management of one studio's site (S2b, docs/SAYFA_MOTORU.md
 * "Yazılar / blog"). Every query is scoped by the caller's studioId; the
 * platform site is the platform tenant's site, managed by the super admin
 * through the same routes.
 */
@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sites: SitesService,
    private readonly feedCache: ArticlesFeedCache,
    private readonly siteCache: SiteCacheService,
    private readonly indexNow: IndexNowService,
  ) {}

  /**
   * Article content changed: the RSS feed cache is dropped, and when published content is affected the web app is
   * asked to purge its cached pages (ISR, docs/SEO.md). A draft is not public, so editing one purges nothing.
   */
  private changed(studioId: string, siteId: string, publicChange: boolean): void {
    this.feedCache.invalidateSite(siteId);
    if (publicChange) void this.siteCache.purgeStudio(studioId);
  }

  private async siteIdOf(studioId: string): Promise<string> {
    return (await this.sites.ensureSite(studioId)).id;
  }

  private async articleOrThrow(studioId: string, articleId: string): Promise<ArticleRow> {
    const article = await this.prisma.article.findFirst({ where: { id: articleId, studioId }, include: ARTICLE_INCLUDE });
    if (!article) throw articleError('ARTICLE_NOT_FOUND');
    return article;
  }

  private async assertTags(studioId: string, siteId: string, tagIds: readonly string[]): Promise<void> {
    if (tagIds.length === 0) return;
    const unique = Array.from(new Set(tagIds));
    const found = await this.prisma.articleTag.count({ where: { id: { in: unique }, studioId, siteId } });
    if (found !== unique.length) throw articleError('ARTICLE_TAG_NOT_FOUND');
  }

  async list(studioId: string, query: ListArticlesQuery): Promise<PaginatedDTO<ArticleDTO>> {
    const siteId = await this.siteIdOf(studioId);
    const where: Prisma.ArticleWhereInput = { studioId, siteId, ...(query.status ? { status: query.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        include: ARTICLE_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.article.count({ where }),
    ]);
    return { items: rows.map(toArticleDto), total, page: query.page, pageSize: query.pageSize };
  }

  async get(studioId: string, articleId: string): Promise<ArticleDTO> {
    return toArticleDto(await this.articleOrThrow(studioId, articleId));
  }

  async create(studioId: string, userId: string, input: CreateArticleInput): Promise<ArticleDTO> {
    const siteId = await this.siteIdOf(studioId);
    await this.assertTags(studioId, siteId, input.tagIds);
    try {
      const article = await this.prisma.article.create({
        data: {
          siteId,
          studioId,
          authorName: input.authorName,
          authorUserId: userId,
          coverImageUrl: input.coverImageUrl,
          locales: { create: input.locales.map((l) => ({ siteId, locale: l.locale, ...localeData(l) })) },
          tags: { create: Array.from(new Set(input.tagIds)).map((tagId) => ({ tagId })) },
        },
        include: ARTICLE_INCLUDE,
      });
      this.changed(studioId, siteId, false);
      return toArticleDto(article);
    } catch (err) {
      if (isUniqueViolation(err)) throw articleError('ARTICLE_SLUG_TAKEN');
      throw err;
    }
  }

  async update(studioId: string, articleId: string, input: UpdateArticleInput): Promise<ArticleDTO> {
    const existing = await this.articleOrThrow(studioId, articleId);
    if (input.tagIds) await this.assertTags(studioId, existing.siteId, input.tagIds);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.article.update({
          where: { id: existing.id },
          data: {
            authorName: input.authorName,
            coverImageUrl: input.coverImageUrl === undefined ? undefined : input.coverImageUrl || null,
            // Touch the row so updatedAt (sitemap lastmod, dateModified) moves with locale-only edits too.
            updatedAt: new Date(),
          },
        });
        if (input.locales) {
          const keep = input.locales.map((l) => l.locale);
          await tx.articleLocale.deleteMany({ where: { articleId: existing.id, locale: { notIn: keep } } });
          for (const l of input.locales) {
            const data = localeData(l);
            await tx.articleLocale.upsert({
              where: { articleId_locale: { articleId: existing.id, locale: l.locale } },
              create: { articleId: existing.id, siteId: existing.siteId, locale: l.locale, ...data },
              update: data,
            });
          }
        }
        if (input.tagIds) {
          await tx.articleTagLink.deleteMany({ where: { articleId: existing.id } });
          const tagIds = Array.from(new Set(input.tagIds));
          if (tagIds.length > 0) await tx.articleTagLink.createMany({ data: tagIds.map((tagId) => ({ articleId: existing.id, tagId })) });
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw articleError('ARTICLE_SLUG_TAKEN');
      throw err;
    }
    this.changed(studioId, existing.siteId, existing.status === 'PUBLISHED');
    return this.get(studioId, existing.id);
  }

  /** DRAFT or ARCHIVED -> PUBLISHED. The first publication date is kept on a republish. */
  async publish(studioId: string, articleId: string): Promise<ArticleDTO> {
    const existing = await this.articleOrThrow(studioId, articleId);
    const article = await this.prisma.article.update({
      where: { id: existing.id },
      data: { status: 'PUBLISHED', publishedAt: existing.publishedAt ?? new Date() },
      include: ARTICLE_INCLUDE,
    });
    this.changed(studioId, existing.siteId, true);
    void this.indexNow.notifyArticle(studioId, existing.id);
    return toArticleDto(article);
  }

  /** Takes the article off the public site without deleting it. */
  async archive(studioId: string, articleId: string): Promise<ArticleDTO> {
    const existing = await this.articleOrThrow(studioId, articleId);
    const article = await this.prisma.article.update({ where: { id: existing.id }, data: { status: 'ARCHIVED' }, include: ARTICLE_INCLUDE });
    this.changed(studioId, existing.siteId, existing.status === 'PUBLISHED');
    if (existing.status === 'PUBLISHED') void this.indexNow.notifyArticle(studioId, existing.id);
    return toArticleDto(article);
  }

  async remove(studioId: string, articleId: string): Promise<void> {
    const existing = await this.articleOrThrow(studioId, articleId);
    if (existing.status === 'PUBLISHED') throw articleError('ARTICLE_NOT_DELETABLE');
    await this.prisma.article.delete({ where: { id: existing.id } });
    this.changed(studioId, existing.siteId, false);
  }

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  async listTags(studioId: string): Promise<ArticleTagDTO[]> {
    const siteId = await this.siteIdOf(studioId);
    const tags = await this.prisma.articleTag.findMany({
      where: { studioId, siteId },
      include: { _count: { select: { articles: true } } },
      orderBy: { slug: 'asc' },
    });
    return tags.map((t) => ({ id: t.id, slug: t.slug, labels: (t.labels ?? {}) as Record<string, string>, articleCount: t._count.articles }));
  }

  async createTag(studioId: string, input: UpsertArticleTagInput): Promise<ArticleTagDTO> {
    const siteId = await this.siteIdOf(studioId);
    try {
      const tag = await this.prisma.articleTag.create({ data: { siteId, studioId, slug: input.slug, labels: input.labels } });
      this.changed(studioId, siteId, false);
      return { id: tag.id, slug: tag.slug, labels: input.labels, articleCount: 0 };
    } catch (err) {
      if (isUniqueViolation(err)) throw articleError('ARTICLE_TAG_SLUG_TAKEN');
      throw err;
    }
  }

  async updateTag(studioId: string, tagId: string, input: UpsertArticleTagInput): Promise<ArticleTagDTO> {
    const existing = await this.prisma.articleTag.findFirst({ where: { id: tagId, studioId } });
    if (!existing) throw articleError('ARTICLE_TAG_NOT_FOUND');
    try {
      const tag = await this.prisma.articleTag.update({
        where: { id: existing.id },
        data: { slug: input.slug, labels: input.labels },
        include: { _count: { select: { articles: true } } },
      });
      this.changed(studioId, existing.siteId, true);
      return { id: tag.id, slug: tag.slug, labels: input.labels, articleCount: tag._count.articles };
    } catch (err) {
      if (isUniqueViolation(err)) throw articleError('ARTICLE_TAG_SLUG_TAKEN');
      throw err;
    }
  }

  async removeTag(studioId: string, tagId: string): Promise<void> {
    const existing = await this.prisma.articleTag.findFirst({ where: { id: tagId, studioId } });
    if (!existing) throw articleError('ARTICLE_TAG_NOT_FOUND');
    await this.prisma.articleTag.delete({ where: { id: existing.id } });
    this.changed(studioId, existing.siteId, true);
  }
}
