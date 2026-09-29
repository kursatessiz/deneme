import { Module } from '@nestjs/common';
import { PlatformAccessService } from './platform-access.service';

/** Core of platform access (M1): the sync writer only, so InvitesModule can import it without a cycle. */
@Module({
  providers: [PlatformAccessService],
  exports: [PlatformAccessService],
})
export class PlatformAccessModule {}
