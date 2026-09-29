import { Module } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { GamificationController } from './gamification.controller';
import { LoyaltyCoreModule } from '../loyalty/loyalty-core.module';

@Module({
  imports: [LoyaltyCoreModule],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
