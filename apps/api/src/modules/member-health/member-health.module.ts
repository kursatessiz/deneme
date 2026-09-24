import { Module } from '@nestjs/common';
import { MemberHealthService } from './member-health.service';
import { MemberHealthController } from './member-health.controller';
import { StudioMemberHealthController } from './studio-member-health.controller';

@Module({
  controllers: [MemberHealthController, StudioMemberHealthController],
  providers: [MemberHealthService],
  exports: [MemberHealthService],
})
export class MemberHealthModule {}
