import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  imports: [AuthModule, CrmCoreModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
