import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { ChurnModule } from '../churn/churn.module';
import { ReportsModule } from '../reports/reports.module';
import { RetailModule } from '../retail/retail.module';
import { DashboardController } from './dashboard.controller';
import { DashboardDataService } from './dashboard-data.service';
import { DashboardLayoutService } from './dashboard-layout.service';

/** Overview card board: per-membership layouts and the batched card data. */
@Module({
  imports: [AuthModule, ReportsModule, BranchesModule, ChurnModule, RetailModule],
  controllers: [DashboardController],
  providers: [DashboardLayoutService, DashboardDataService],
})
export class DashboardModule {}
