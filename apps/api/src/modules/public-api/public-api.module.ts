import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { RedisModule } from '../redis/redis.module';
import { PublicApiController } from './public-api.controller';
import { EmbedPublicController } from './embed-public.controller';
import { EmbedRateLimitGuard } from './embed-rate-limit.guard';
import { PublicApiService } from './public-api.service';
import { HooksPublicController } from './hooks-public.controller';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { ContactsPublicController } from './contacts-public.controller';
import { PublicContactsService } from './contacts-public.service';
import { PublicIdempotencyService } from './idempotency.service';

@Module({
  imports: [ApiKeysModule, SchedulesModule, RedisModule, WebhooksModule, CrmCoreModule],
  controllers: [PublicApiController, HooksPublicController, EmbedPublicController, ContactsPublicController],
  providers: [PublicApiService, EmbedRateLimitGuard, PublicContactsService, PublicIdempotencyService],
})
export class PublicApiModule {}
