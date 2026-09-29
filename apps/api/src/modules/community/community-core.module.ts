import { Module } from '@nestjs/common';
import { CommunityAccessService } from './community-access.service';

/**
 * The access resolver without controllers or module dependencies beyond
 * the global Prisma module, so the video library (W19) can share it
 * without an import cycle (same pattern as LoyaltyCoreModule).
 */
@Module({
  providers: [CommunityAccessService],
  exports: [CommunityAccessService],
})
export class CommunityCoreModule {}
