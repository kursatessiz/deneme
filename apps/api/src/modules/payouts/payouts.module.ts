import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { I18nModule } from '../i18n/i18n.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { PayoutSyncService } from './payout-sync.service';
import { PayoutReconcileService } from './payout-reconcile.service';
import { PayoutsJobsService } from './payouts-jobs.service';

/** Bank payouts and reconciliation (G5d-2): provider payouts, their items, matching to payments, export. */
@Module({
  imports: [AuthModule, I18nModule, PaymentsModule],
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutSyncService, PayoutReconcileService, PayoutsJobsService],
  exports: [PayoutsJobsService, PayoutSyncService],
})
export class PayoutsModule {}
