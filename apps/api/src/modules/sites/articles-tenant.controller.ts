import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  CreateArticleSchema,
  ListArticlesQuerySchema,
  UpdateArticleSchema,
  UpsertArticleTagSchema,
  type CreateArticleInput,
  type ListArticlesQuery,
  type UpdateArticleInput,
  type UpsertArticleTagInput,
} from '@platform/shared';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ArticlesService } from './articles.service';

/**
 * A site's blog articles and tags (S2b, docs/SAYFA_MOTORU.md "Yazılar / blog").
 * Tenant staff need `sites.articles.manage`; the platform site's articles are
 * managed by the super admin on the platform studio through the same routes
 * (StudioTenantGuard gives a super admin every permission on any studioId),
 * exactly like the page engine's own pages.
 */
@Controller('sites/studio/:studioId')
@StudioScoped()
export class ArticlesTenantController {
  constructor(private readonly articles: ArticlesService) {}

  @Get('articles')
  @RequirePermission('sites.articles.manage')
  list(@Tenant() tenant: TenantContext, @ZodQuery(ListArticlesQuerySchema) query: ListArticlesQuery) {
    return this.articles.list(tenant.studioId, query);
  }

  @Post('articles')
  @RequirePermission('sites.articles.manage')
  create(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateArticleSchema) body: CreateArticleInput) {
    return this.articles.create(tenant.studioId, user.id, body);
  }

  @Get('articles/:articleId')
  @RequirePermission('sites.articles.manage')
  get(@Tenant() tenant: TenantContext, @Param('articleId', ParseUUIDPipe) articleId: string) {
    return this.articles.get(tenant.studioId, articleId);
  }

  @Patch('articles/:articleId')
  @RequirePermission('sites.articles.manage')
  update(@Tenant() tenant: TenantContext, @Param('articleId', ParseUUIDPipe) articleId: string, @ZodBody(UpdateArticleSchema) body: UpdateArticleInput) {
    return this.articles.update(tenant.studioId, articleId, body);
  }

  @Post('articles/:articleId/publish')
  @RequirePermission('sites.articles.manage')
  publish(@Tenant() tenant: TenantContext, @Param('articleId', ParseUUIDPipe) articleId: string) {
    return this.articles.publish(tenant.studioId, articleId);
  }

  @Post('articles/:articleId/archive')
  @RequirePermission('sites.articles.manage')
  archive(@Tenant() tenant: TenantContext, @Param('articleId', ParseUUIDPipe) articleId: string) {
    return this.articles.archive(tenant.studioId, articleId);
  }

  @Delete('articles/:articleId')
  @RequirePermission('sites.articles.manage')
  async remove(@Tenant() tenant: TenantContext, @Param('articleId', ParseUUIDPipe) articleId: string) {
    await this.articles.remove(tenant.studioId, articleId);
    return { deleted: true };
  }

  @Get('article-tags')
  @RequirePermission('sites.articles.manage')
  async listTags(@Tenant() tenant: TenantContext) {
    return { items: await this.articles.listTags(tenant.studioId) };
  }

  @Post('article-tags')
  @RequirePermission('sites.articles.manage')
  createTag(@Tenant() tenant: TenantContext, @ZodBody(UpsertArticleTagSchema) body: UpsertArticleTagInput) {
    return this.articles.createTag(tenant.studioId, body);
  }

  @Patch('article-tags/:tagId')
  @RequirePermission('sites.articles.manage')
  updateTag(@Tenant() tenant: TenantContext, @Param('tagId', ParseUUIDPipe) tagId: string, @ZodBody(UpsertArticleTagSchema) body: UpsertArticleTagInput) {
    return this.articles.updateTag(tenant.studioId, tagId, body);
  }

  @Delete('article-tags/:tagId')
  @RequirePermission('sites.articles.manage')
  async removeTag(@Tenant() tenant: TenantContext, @Param('tagId', ParseUUIDPipe) tagId: string) {
    await this.articles.removeTag(tenant.studioId, tagId);
    return { deleted: true };
  }
}
