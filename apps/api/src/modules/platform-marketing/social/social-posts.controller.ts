import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  CreateSocialPostSchema,
  ScheduleSocialPostSchema,
  SocialPostsQuerySchema,
  UpdateSocialPostSchema,
  type CreateSocialPostInput,
  type ScheduleSocialPostInput,
  type SocialPostsQuery,
  type UpdateSocialPostInput,
} from '@platform/shared';
import { Platform, PlatformScoped, RequirePlatformPermission } from '../../auth/decorators/platform-scoped.decorator';
import type { PlatformContext } from '../../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../../common/zod-body.pipe';
import { SocialPostsService } from './social-posts.service';

/**
 * Organic social posts of the platform tenant (M4b). Reading needs
 * platform.marketing.view, drafting and editing platform.marketing.manage,
 * and everything that lets a post go out (schedule, cancel, publish now)
 * platform.marketing.send. The approval itself is decided in the approval
 * queue (platform.marketing.approve, super admin).
 */
@Controller('platform/marketing/social-posts')
@PlatformScoped()
export class SocialPostsController {
  constructor(private readonly posts: SocialPostsService) {}

  @Get()
  @RequirePlatformPermission('platform.marketing.view')
  list(@Platform() platform: PlatformContext, @ZodQuery(SocialPostsQuerySchema) query: SocialPostsQuery) {
    return this.posts.list(platform, query);
  }

  @Get(':id')
  @RequirePlatformPermission('platform.marketing.view')
  get(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.get(platform, id);
  }

  @Post()
  @RequirePlatformPermission('platform.marketing.manage')
  create(@Platform() platform: PlatformContext, @ZodBody(CreateSocialPostSchema) body: CreateSocialPostInput) {
    return this.posts.create(platform, body);
  }

  @Patch(':id')
  @RequirePlatformPermission('platform.marketing.manage')
  update(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(UpdateSocialPostSchema) body: UpdateSocialPostInput) {
    return this.posts.update(platform, id, body);
  }

  @Delete(':id')
  @RequirePlatformPermission('platform.marketing.manage')
  remove(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.remove(platform, id);
  }

  @Post(':id/schedule')
  @HttpCode(200)
  @RequirePlatformPermission('platform.marketing.send')
  schedule(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(ScheduleSocialPostSchema) body: ScheduleSocialPostInput) {
    return this.posts.schedule(platform, id, body.scheduledAt);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePlatformPermission('platform.marketing.send')
  cancel(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.cancel(platform, id);
  }

  @Post(':id/publish-now')
  @HttpCode(200)
  @RequirePlatformPermission('platform.marketing.send')
  publishNow(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.publishNow(platform, id);
  }
}
