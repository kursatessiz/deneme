import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

/** Accounting export (G3c-3): read-only journals over payments, refunds and expenses. */
@Module({
  imports: [AuthModule],
  controllers: [AccountingController],
  providers: [AccountingService],
})
export class AccountingModule {}
