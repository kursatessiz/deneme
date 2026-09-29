import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { LoyaltyCoreModule } from './loyalty-core.module';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyJobsService } from './loyalty-jobs.service';

/**
 * Loyalty points (G3a, docs/SADAKAT.md): settings, earn rules, rewards,
 * member balances, adjustments and redemptions, and the heartbeat work
 * (birthdays, expiry, expiry notices). MessagingModule is global.
 */
@Module({
  imports: [AuthModule, LoyaltyCoreModule, PromotionsModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, LoyaltyJobsService],
  exports: [LoyaltyJobsService],
})
export class LoyaltyModule {}
