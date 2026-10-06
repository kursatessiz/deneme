import { Controller, Get, Header, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { LocaleCodeSchema, PublicArticlesQuerySchema, type PublicArticlesQuery } from '@platform/shared';
import { ZodQuery } from '../../common/zod-body.pipe';
import { PublicArticlesService } from './public-articles.service';
import { SitesFeedRateLimitGuard } from './sites-rate-limit.guard';
import { apiError } from '../../common/api-error';

function localeOr404(locale: string | undefined): string {
  const parsed = LocaleCodeSchema.safeParse(locale);
  if (!parsed.success) throw new NotFoundException(apiError('apiErrors.sites.localeNotFound'));
  return parsed.data;
}

/**
 * Unauthenticated blog reads next to the page engine's public endpoints
 * (S2b, docs/PUBLIC_API.md). Only PUBLISHED articles of an active studio's
 * site are ever returned; anything else is a 404.
 */
@Controller('public/sites/:studioSlug')
export class PublicArticlesController {
  constructor(private readonly articles: PublicArticlesService) {}

  @Get('articles')
  list(@Param('studioSlug') studioSlug: string, @ZodQuery(PublicArticlesQuerySchema) query: PublicArticlesQuery) {
    return this.articles.list(studioSlug, query);
  }

  @Get('articles/:articleSlug')
  get(@Param('studioSlug') studioSlug: string, @Param('articleSlug') articleSlug: string, @Query('locale') locale: string) {
    return this.articles.get(studioSlug, localeOr404(locale), articleSlug);
  }

  @Get('article-tags')
  async tags(@Param('studioSlug') studioSlug: string, @Query('locale') locale: string) {
    return { items: await this.articles.tags(studioSlug, localeOr404(locale)) };
  }

  /** RSS 2.0, newest published articles in one locale; cached in process and by clients for five minutes. */
  @Get('feed/:locale')
  @UseGuards(SitesFeedRateLimitGuard)
  @Header('Content-Type', 'application/rss+xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  feed(@Param('studioSlug') studioSlug: string, @Param('locale') locale: string) {
    return this.articles.feed(studioSlug, localeOr404(locale));
  }
}
