import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';
import { I18nService } from './i18n.service';
import { I18nPublicController } from './i18n-public.controller';
import { I18nPublicRateLimitGuard } from './i18n-public-rate-limit.guard';
import { AdminI18nController } from './admin-i18n.controller';
import { MeLocaleController, StudioLocaleController } from './locale.controller';

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [I18nPublicController, AdminI18nController, MeLocaleController, StudioLocaleController],
  providers: [I18nService, I18nPublicRateLimitGuard],
  exports: [I18nService],
})
export class I18nModule {}
