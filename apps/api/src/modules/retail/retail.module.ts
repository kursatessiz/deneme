import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { CrmCoreModule } from '../crm/crm-core.module';
import { RetailController } from './retail.controller';
import { RetailCatalogService } from './retail-catalog.service';
import { RetailSalesService } from './retail-sales.service';

/**
 * Retail and stock (G3c-2, docs/PERAKENDE.md): product catalogue, stock
 * ledger and desk sales. Promo codes come from PromotionsModule; CRM
 * conversions and loyalty points from the shared CRM hooks.
 */
@Module({
  imports: [AuthModule, PromotionsModule, WebhooksModule, CrmCoreModule],
  controllers: [RetailController],
  providers: [RetailCatalogService, RetailSalesService],
  exports: [RetailCatalogService, RetailSalesService],
})
export class RetailModule {}
