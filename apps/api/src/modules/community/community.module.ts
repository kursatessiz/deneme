import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommunityCoreModule } from './community-core.module';
import { CommunityController, CommunitySelfController } from './community.controller';
import { CommunityPublicController, CommunityPublicRateLimitGuard } from './community-public.controller';
import { CommunityPostsService } from './community-posts.service';
import { CommunityInteractionsService } from './community-interactions.service';
import { AccessTiersService } from './access-tiers.service';

/**
 * Community feed and access tiers (G5b, docs/TOPLULUK.md). The self
 * controller is listed first so its `self` routes are matched before the
 * staff routes. PrismaModule and RedisModule are global.
 */
@Module({
  imports: [AuthModule, CommunityCoreModule],
  controllers: [CommunitySelfController, CommunityController, CommunityPublicController],
  providers: [CommunityPostsService, CommunityInteractionsService, AccessTiersService, CommunityPublicRateLimitGuard],
})
export class CommunityModule {}
