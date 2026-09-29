import { Module } from '@nestjs/common';
import { LoyaltyLedgerService } from './loyalty-ledger.service';
import { LoyaltyEarnService } from './loyalty-earn.service';

/**
 * The loyalty ledger and earning sources without controllers or module
 * dependencies beyond the global PrismaModule, so the modules that produce
 * earning events (CRM hooks for check-ins and payments, referrals,
 * gamification, journeys) can import it without an import cycle through
 * LoyaltyModule.
 */
@Module({
  providers: [LoyaltyLedgerService, LoyaltyEarnService],
  exports: [LoyaltyLedgerService, LoyaltyEarnService],
})
export class LoyaltyCoreModule {}
