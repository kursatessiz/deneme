import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { PlatformAccessModule } from '../platform-access/platform-access.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  imports: [AuthModule, CrmCoreModule, PlatformAccessModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
