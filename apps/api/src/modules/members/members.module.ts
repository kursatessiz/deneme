import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { AuthModule } from '../auth/auth.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { CrmCoreModule } from '../crm/crm-core.module';

@Module({
  imports: [AuthModule, FeedbackModule, WebhooksModule, CrmCoreModule],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
