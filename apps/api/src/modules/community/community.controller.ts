import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  CommunityCommentListQuerySchema,
  CommunityFeedQuerySchema,
  CommunityPostListQuerySchema,
  CreateAccessTierSchema,
  CreateCommunityCommentSchema,
  CreateCommunityPostSchema,
  UpdateAccessTierSchema,
  UpdateCommunityPostSchema,
} from '@platform/shared';
import type {
  CommunityCommentListQuery,
  CommunityFeedQuery,
  CommunityPostListQuery,
  CreateAccessTierInput,
  CreateCommunityCommentInput,
  CreateCommunityPostInput,
  UpdateAccessTierInput,
  UpdateCommunityPostInput,
} from '@platform/shared';
import { RequirePermission, SelfService, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { AccessTiersService } from './access-tiers.service';
import { CommunityInteractionsService } from './community-interactions.service';
import { CommunityPostsService } from './community-posts.service';

/**
 * Member side of the community feed (docs/TOPLULUK.md). Any active member
 * of the studio may call these; CommunityAccessService limits every read
 * and write to the posts the caller may see (their access tiers, or every
 * published post for staff with community.view). Registered before the
 * staff controller so `self` is never taken for another route.
 */
@Controller('studios/:studioId/community/self')
@StudioScoped()
export class CommunitySelfController {
  constructor(
    private readonly posts: CommunityPostsService,
    private readonly interactions: CommunityInteractionsService,
  ) {}

  @Get('feed')
  @SelfService()
  async feed(@Tenant() tenant: TenantContext, @ZodQuery(CommunityFeedQuerySchema) query: CommunityFeedQuery) {
    return { items: await this.posts.feed(tenant, query) };
  }

  @Get('posts/:postId')
  @SelfService()
  get(@Tenant() tenant: TenantContext, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.posts.getForFeed(tenant, postId);
  }

  @Get('posts/:postId/comments')
  @SelfService()
  async comments(
    @Tenant() tenant: TenantContext,
    @Param('postId', ParseUUIDPipe) postId: string,
    @ZodQuery(CommunityCommentListQuerySchema) query: CommunityCommentListQuery,
  ) {
    return { items: await this.interactions.listComments(tenant, postId, query) };
  }

  @Post('posts/:postId/comments')
  @SelfService()
  comment(
    @Tenant() tenant: TenantContext,
    @Param('postId', ParseUUIDPipe) postId: string,
    @ZodBody(CreateCommunityCommentSchema) body: CreateCommunityCommentInput,
  ) {
    return this.interactions.addComment(tenant, postId, body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  @SelfService()
  async deleteComment(@Tenant() tenant: TenantContext, @Param('commentId', ParseUUIDPipe) commentId: string) {
    await this.interactions.deleteOwnComment(tenant, commentId);
  }

  @Put('posts/:postId/like')
  @SelfService()
  like(@Tenant() tenant: TenantContext, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.interactions.like(tenant, postId);
  }

  @Delete('posts/:postId/like')
  @SelfService()
  unlike(@Tenant() tenant: TenantContext, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.interactions.unlike(tenant, postId);
  }
}

/**
 * Staff side of the community (docs/TOPLULUK.md): posts, the public share
 * link, comment moderation and access tiers. The studio always comes from
 * the tenant guard. Writes are blocked in restricted mode (BillingWriteGuard).
 */
@Controller('studios/:studioId/community')
@StudioScoped()
export class CommunityController {
  constructor(
    private readonly posts: CommunityPostsService,
    private readonly interactions: CommunityInteractionsService,
    private readonly tiers: AccessTiersService,
  ) {}

  // -- Posts ---------------------------------------------------------------------

  @Get('posts')
  @RequirePermission('community.view')
  async list(@Tenant() tenant: TenantContext, @ZodQuery(CommunityPostListQuerySchema) query: CommunityPostListQuery) {
    return { items: await this.posts.listForStaff(tenant, query) };
  }

  @Post('posts')
  @RequirePermission('community.manage')
  create(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateCommunityPostSchema) body: CreateCommunityPostInput) {
    return this.posts.create(tenant, user.id, body);
  }

  @Get('posts/:postId')
  @RequirePermission('community.view')
  get(@Tenant() tenant: TenantContext, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.posts.getForStaff(tenant, postId);
  }

  @Patch('posts/:postId')
  @RequirePermission('community.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('postId', ParseUUIDPipe) postId: string,
    @ZodBody(UpdateCommunityPostSchema) body: UpdateCommunityPostInput,
  ) {
    return this.posts.update(tenant, user.id, postId, body);
  }

  @Post('posts/:postId/publish')
  @HttpCode(200)
  @RequirePermission('community.manage')
  publish(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.posts.publish(tenant, user.id, postId);
  }

  @Post('posts/:postId/archive')
  @HttpCode(200)
  @RequirePermission('community.manage')
  archive(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.posts.archive(tenant, user.id, postId);
  }

  @Post('posts/:postId/share')
  @HttpCode(200)
  @RequirePermission('community.manage')
  share(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.posts.enableShare(tenant, user.id, postId);
  }

  @Delete('posts/:postId/share')
  @RequirePermission('community.manage')
  unshare(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.posts.revokeShare(tenant, user.id, postId);
  }

  // -- Comments ------------------------------------------------------------------

  @Get('posts/:postId/comments')
  @RequirePermission('community.view')
  async comments(
    @Tenant() tenant: TenantContext,
    @Param('postId', ParseUUIDPipe) postId: string,
    @ZodQuery(CommunityCommentListQuerySchema) query: CommunityCommentListQuery,
  ) {
    return { items: await this.interactions.listForStaff(tenant, postId, query) };
  }

  @Post('comments/:commentId/hide')
  @HttpCode(200)
  @RequirePermission('community.moderate')
  hide(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('commentId', ParseUUIDPipe) commentId: string) {
    return this.interactions.setHidden(tenant, user.id, commentId, true);
  }

  @Post('comments/:commentId/unhide')
  @HttpCode(200)
  @RequirePermission('community.moderate')
  unhide(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('commentId', ParseUUIDPipe) commentId: string) {
    return this.interactions.setHidden(tenant, user.id, commentId, false);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  @RequirePermission('community.moderate')
  async removeComment(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('commentId', ParseUUIDPipe) commentId: string) {
    await this.interactions.moderatorDelete(tenant, user.id, commentId);
  }

  // -- Access tiers --------------------------------------------------------------

  @Get('tiers')
  @RequirePermission('community.view')
  async listTiers(@Tenant() tenant: TenantContext) {
    return { items: await this.tiers.list(tenant) };
  }

  @Post('tiers')
  @RequirePermission('community.manage')
  createTier(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateAccessTierSchema) body: CreateAccessTierInput) {
    return this.tiers.create(tenant, user.id, body);
  }

  @Patch('tiers/:tierId')
  @RequirePermission('community.manage')
  updateTier(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('tierId', ParseUUIDPipe) tierId: string,
    @ZodBody(UpdateAccessTierSchema) body: UpdateAccessTierInput,
  ) {
    return this.tiers.update(tenant, user.id, tierId, body);
  }

  @Delete('tiers/:tierId')
  @HttpCode(204)
  @RequirePermission('community.manage')
  async removeTier(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('tierId', ParseUUIDPipe) tierId: string) {
    await this.tiers.remove(tenant, user.id, tierId);
  }
}
