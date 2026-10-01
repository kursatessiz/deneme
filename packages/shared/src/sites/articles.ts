import { z } from 'zod';
import { LocaleCodeSchema } from '../i18n/locales';
import type { TenantTheme } from '../design';
import type { SiteKind } from './site';
import { unsafeArticleLinks } from './article-markup';

/**
 * Blog articles on the page engine (S2b, docs/SAYFA_MOTORU.md "Yazılar / blog").
 * Both the platform site and tenant sites publish articles through the same
 * contracts; text lives per locale, tags are locale-neutral slugs with a label
 * per locale. Publishing is status + publishedAt (no version snapshots).
 */

export const ARTICLE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

/** Stable error codes; clients translate `articles.error.<code>`. */
export const ARTICLE_ERROR_CODES = [
  'ARTICLE_NOT_FOUND',
  'ARTICLE_SLUG_TAKEN',
  'ARTICLE_TAG_NOT_FOUND',
  'ARTICLE_TAG_SLUG_TAKEN',
  'ARTICLE_NOT_DELETABLE',
] as const;
export type ArticleErrorCode = (typeof ARTICLE_ERROR_CODES)[number];

/** First path segment after the locale that belongs to the blog; page engine slugs may not start with it. */
export const BLOG_PATH_SEGMENT = 'blog';
/** Segment of the tag listing under the blog: `/<locale>/blog/tag/<tag>`. */
export const BLOG_TAG_PATH_SEGMENT = 'tag';
/** File name of the per-locale RSS feed on the site: `/<locale>/blog/rss.xml`. */
export const BLOG_FEED_FILE = 'rss.xml';

export const ARTICLE_PAGE_SIZE_DEFAULT = 12;
export const ARTICLE_PAGE_SIZE_MAX = 50;
/** Newest published articles in an RSS feed. */
export const ARTICLE_FEED_LIMIT = 30;

/** One path segment: lowercase letters, digits and single hyphens. */
export const ARTICLE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const ArticleSlug = z.string().trim().toLowerCase().min(1).max(160).regex(ARTICLE_SLUG_PATTERN, 'Invalid slug');
const TagSlug = z.string().trim().toLowerCase().min(1).max(80).regex(ARTICLE_SLUG_PATTERN, 'Invalid slug');
const HttpsUrl = z.string().trim().url().max(2000).regex(/^https:\/\//i, 'https only');
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const ArticleBodySchema = z
  .string()
  .max(100_000)
  .refine((body) => body.trim().length > 0, 'Body is required')
  .refine((body) => unsafeArticleLinks(body).length === 0, 'Links must be https');

export const ArticleLocaleInputSchema = z.object({
  locale: LocaleCodeSchema,
  slug: ArticleSlug,
  title: z.string().trim().min(1).max(200),
  excerpt: OptionalText(500),
  body: ArticleBodySchema,
  seoTitle: OptionalText(200),
  seoDescription: OptionalText(400),
  ogImageUrl: HttpsUrl.optional().nullable().transform((v) => v ?? null),
});
export type ArticleLocaleInput = z.infer<typeof ArticleLocaleInputSchema>;

const LocalesArray = z
  .array(ArticleLocaleInputSchema)
  .min(1)
  .max(20)
  .refine((items) => new Set(items.map((i) => i.locale)).size === items.length, 'Duplicate locale');

export const CreateArticleSchema = z
  .object({
    authorName: z.string().trim().min(1).max(120),
    coverImageUrl: HttpsUrl.optional().nullable().transform((v) => v ?? null),
    tagIds: z.array(z.string().uuid()).max(20).default([]),
    locales: LocalesArray,
  })
  .strict();
export type CreateArticleInput = z.infer<typeof CreateArticleSchema>;

/** Every field optional; `locales` and `tagIds` replace the whole set when given. */
export const UpdateArticleSchema = z
  .object({
    authorName: z.string().trim().min(1).max(120).optional(),
    coverImageUrl: HttpsUrl.optional().nullable(),
    tagIds: z.array(z.string().uuid()).max(20).optional(),
    locales: LocalesArray.optional(),
  })
  .strict();
export type UpdateArticleInput = z.infer<typeof UpdateArticleSchema>;

export const UpsertArticleTagSchema = z
  .object({
    slug: TagSlug,
    labels: z
      .record(LocaleCodeSchema, z.string().trim().min(1).max(60))
      .refine((labels) => Object.keys(labels).length > 0, 'At least one label'),
  })
  .strict();
export type UpsertArticleTagInput = z.infer<typeof UpsertArticleTagSchema>;

const PageNumber = z.coerce.number().int().min(1).max(10_000).default(1);
const PageSize = z.coerce.number().int().min(1).max(ARTICLE_PAGE_SIZE_MAX).default(ARTICLE_PAGE_SIZE_DEFAULT);

export const ListArticlesQuerySchema = z.object({
  page: PageNumber,
  pageSize: PageSize,
  status: z.enum(ARTICLE_STATUSES).optional(),
});
export type ListArticlesQuery = z.infer<typeof ListArticlesQuerySchema>;

export const PublicArticlesQuerySchema = z.object({
  locale: LocaleCodeSchema,
  page: PageNumber,
  pageSize: PageSize,
  tag: TagSlug.optional(),
});
export type PublicArticlesQuery = z.infer<typeof PublicArticlesQuerySchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface ArticleTagDTO {
  id: string;
  slug: string;
  labels: Record<string, string>;
  articleCount: number;
}

export interface ArticleLocaleDTO {
  locale: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  readingMinutes: number;
}

export interface ArticleDTO {
  id: string;
  status: ArticleStatus;
  authorName: string;
  authorUserId: string | null;
  coverImageUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
  locales: ArticleLocaleDTO[];
}

export interface PaginatedDTO<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** The site a public article response belongs to: enough for the shell, metadata and structured data. */
export interface PublicArticleSiteDTO {
  siteKind: SiteKind;
  studioSlug: string;
  /** Platform product name or the studio's name (tenant data, never translated). */
  siteName: string;
  /** Publisher of the articles in structured data: the platform company or the studio. */
  publisherName: string;
  logoUrl: string | null;
  defaultLocale: string;
  enabledLocales: string[];
  theme: TenantTheme;
}

export interface PublicArticleTagDTO {
  slug: string;
  label: string;
}

export interface PublicArticleSummaryDTO {
  locale: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  authorName: string;
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  tags: PublicArticleTagDTO[];
}

/** GET /public/sites/:slug/articles */
export interface PublicArticleListDTO extends PaginatedDTO<PublicArticleSummaryDTO> {
  site: PublicArticleSiteDTO;
  locale: string;
  /** The tag being filtered on, when `tag` was given. */
  tag: PublicArticleTagDTO | null;
  /** Locales with at least one published article (hreflang of the blog index). */
  publishedLocales: string[];
}

/** GET /public/sites/:slug/articles/:articleSlug */
export interface PublicArticleDTO extends PublicArticleSummaryDTO {
  site: PublicArticleSiteDTO;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  /** Every published locale variant of the same article (hreflang). */
  alternates: Array<{ locale: string; slug: string }>;
}

/** One published locale variant, for sitemap.xml. */
export interface ArticleSitemapEntry {
  articleId: string;
  locale: string;
  slug: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Paths (shared by the web routes, the API feed and the sitemap)
// ---------------------------------------------------------------------------

export function blogIndexPath(locale: string): string {
  return `/${locale}/${BLOG_PATH_SEGMENT}`;
}

export function articlePath(locale: string, slug: string): string {
  return `/${locale}/${BLOG_PATH_SEGMENT}/${slug}`;
}

export function blogTagPath(locale: string, tag: string): string {
  return `/${locale}/${BLOG_PATH_SEGMENT}/${BLOG_TAG_PATH_SEGMENT}/${tag}`;
}

export function blogFeedPath(locale: string): string {
  return `/${locale}/${BLOG_PATH_SEGMENT}/${BLOG_FEED_FILE}`;
}

/** A tag's label in `locale`, else in the site default locale, else its first label, else the slug. */
export function articleTagLabel(tag: { slug: string; labels: Record<string, string> }, locale: string, defaultLocale?: string | null): string {
  return tag.labels[locale] ?? (defaultLocale ? tag.labels[defaultLocale] : undefined) ?? Object.values(tag.labels)[0] ?? tag.slug;
}

/** True when a page engine slug would be shadowed by the blog routes. */
export function isReservedPageSlug(slug: string): boolean {
  return slug.split('/')[0] === BLOG_PATH_SEGMENT;
}
