import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitesModule } from '../invites/invites.module';
import { PlatformAccessModule } from './platform-access.module';
import { PlatformContextController, PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';

/** Super admin "Platform kullanıcıları" and the /platform/context shell endpoint (M1). */
@Module({
  imports: [AuthModule, InvitesModule, PlatformAccessModule],
  controllers: [PlatformUsersController, PlatformContextController],
  providers: [PlatformUsersService],
})
export class PlatformUsersModule {}
