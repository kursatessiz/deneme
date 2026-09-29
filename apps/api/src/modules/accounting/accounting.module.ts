import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { I18nModule } from '../i18n/i18n.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

/** Accounting export (G3c-3): read-only journals over payments, refunds and expenses (XLSX, CSV, JSON). */
@Module({
  imports: [AuthModule, I18nModule],
  controllers: [AccountingController],
  providers: [AccountingService],
})
export class AccountingModule {}
