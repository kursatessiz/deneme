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

@Module({
  imports: [ApiKeysModule, SchedulesModule, RedisModule, WebhooksModule],
  controllers: [PublicApiController, HooksPublicController, EmbedPublicController],
  providers: [PublicApiService, EmbedRateLimitGuard],
})
export class PublicApiModule {}
