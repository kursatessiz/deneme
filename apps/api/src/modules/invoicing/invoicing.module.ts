import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvoiceSettingsController, BillingProfilesController, InvoicesController } from './invoicing.controller';
import { InvoicingService } from './invoicing.service';
import { MockEInvoiceProvider } from './providers/mock-einvoice.provider';
import { ParasutEInvoiceProvider } from './providers/parasut-einvoice.provider';
import { ElogoEInvoiceProvider } from './providers/elogo-einvoice.provider';
import { ForibaEInvoiceProvider } from './providers/foriba-einvoice.provider';
import { UyumsoftEInvoiceProvider } from './providers/uyumsoft-einvoice.provider';
import { EInvoiceProviderRegistry } from './providers/einvoice-provider.registry';

@Module({
  imports: [AuthModule],
  controllers: [InvoiceSettingsController, BillingProfilesController, InvoicesController],
  providers: [
    InvoicingService,
    MockEInvoiceProvider,
    ParasutEInvoiceProvider,
    ElogoEInvoiceProvider,
    ForibaEInvoiceProvider,
    UyumsoftEInvoiceProvider,
    EInvoiceProviderRegistry,
  ],
  exports: [InvoicingService],
})
export class InvoicingModule {}
