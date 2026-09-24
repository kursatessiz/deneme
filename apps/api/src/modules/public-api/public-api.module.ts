import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { RedisModule } from '../redis/redis.module';
import { PublicApiController } from './public-api.controller';
import { EmbedPublicController } from './embed-public.controller';
import { EmbedRateLimitGuard } from './embed-rate-limit.guard';
import { PublicApiService } from './public-api.service';

@Module({
  imports: [ApiKeysModule, SchedulesModule, RedisModule],
  controllers: [PublicApiController, EmbedPublicController],
  providers: [PublicApiService, EmbedRateLimitGuard],
})
export class PublicApiModule {}
