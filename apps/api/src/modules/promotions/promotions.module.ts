import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromotionsController } from './promotions.controller';
import { PromotionsPublicController } from './promotions-public.controller';
import { PromotionsService } from './promotions.service';

@Module({
  imports: [AuthModule],
  controllers: [PromotionsController, PromotionsPublicController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
