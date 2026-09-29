import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AdjustStockSchema,
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  CheckoutSchema,
  CreateProductCategorySchema,
  CreateProductSchema,
  ListProductsQuerySchema,
  ReceiveStockSchema,
  RefundSaleSchema,
  ReportFiltersSchema,
  ReportRangeSchema,
  RetailReportViewSchema,
  RetailSettingsSchema,
  SalesQuerySchema,
  StockMovementsQuerySchema,
  TransferStockSchema,
  UpdateProductCategorySchema,
  UpdateProductSchema,
  VoidSaleSchema,
  createTranslator,
} from '@platform/shared';
import type {
  AdjustStockInput,
  CheckoutInput,
  CreateProductCategoryInput,
  CreateProductInput,
  ListProductsQuery,
  ReceiveStockInput,
  RefundSaleInput,
  ReportFilters,
  ReportRange,
  RetailReportViewQuery,
  RetailSalesReportDTO,
  RetailSettingsInput,
  SalesQuery,
  StockMovementsQuery,
  TransferStockInput,
  UpdateProductCategoryInput,
  UpdateProductInput,
  VoidSaleInput,
} from '@platform/shared';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { toCsv } from '../../common/csv';
import { PrismaService } from '../prisma/prisma.service';
import { RetailCatalogService } from './retail-catalog.service';
import { RetailSalesService } from './retail-sales.service';

/**
 * Retail and stock (G3c-2, docs/PERAKENDE.md). The studio always comes from
 * the tenant guard; branch-restricted staff only see and move stock of
 * their branches.
 */
@Controller('studios/:studioId/retail')
@StudioScoped()
export class RetailController {
  constructor(
    private readonly catalog: RetailCatalogService,
    private readonly sales: RetailSalesService,
    private readonly prisma: PrismaService,
  ) {}

  // -- Settings -------------------------------------------------------------

  @Get('settings')
  @RequirePermission('retail.view')
  getSettings(@Tenant() tenant: TenantContext) {
    return this.catalog.getSettings(tenant.studioId);
  }

  @Put('settings')
  @RequirePermission('retail.manage')
  updateSettings(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(RetailSettingsSchema) body: RetailSettingsInput) {
    return this.catalog.updateSettings(tenant, user.id, body);
  }

  // -- Categories -------------------------------------------------------------

  @Get('categories')
  @RequirePermission('retail.view')
  async listCategories(@Tenant() tenant: TenantContext) {
    return { items: await this.catalog.listCategories(tenant.studioId) };
  }

  @Post('categories')
  @RequirePermission('retail.manage')
  createCategory(@Tenant() tenant: TenantContext, @ZodBody(CreateProductCategorySchema) body: CreateProductCategoryInput) {
    return this.catalog.createCategory(tenant.studioId, body);
  }

  @Patch('categories/:categoryId')
  @RequirePermission('retail.manage')
  updateCategory(
    @Tenant() tenant: TenantContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @ZodBody(UpdateProductCategorySchema) body: UpdateProductCategoryInput,
  ) {
    return this.catalog.updateCategory(tenant.studioId, categoryId, body);
  }

  @Delete('categories/:categoryId')
  @RequirePermission('retail.manage')
  async deleteCategory(@Tenant() tenant: TenantContext, @Param('categoryId', ParseUUIDPipe) categoryId: string) {
    await this.catalog.deleteCategory(tenant.studioId, categoryId);
    return { deleted: true };
  }

  // -- Products ---------------------------------------------------------------

  @Get('products')
  @RequirePermission('retail.view')
  async listProducts(@Tenant() tenant: TenantContext, @ZodQuery(ListProductsQuerySchema) query: ListProductsQuery) {
    return { items: await this.catalog.listProducts(tenant, query) };
  }

  @Get('products/:productId')
  @RequirePermission('retail.view')
  getProduct(@Tenant() tenant: TenantContext, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.catalog.getProduct(tenant, productId);
  }

  @Post('products')
  @RequirePermission('retail.manage')
  createProduct(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateProductSchema) body: CreateProductInput) {
    return this.catalog.createProduct(tenant, user.id, body);
  }

  @Patch('products/:productId')
  @RequirePermission('retail.manage')
  updateProduct(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @ZodBody(UpdateProductSchema) body: UpdateProductInput,
  ) {
    return this.catalog.updateProduct(tenant, user.id, productId, body);
  }

  @Delete('products/:productId')
  @RequirePermission('retail.manage')
  deleteProduct(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.catalog.deleteProduct(tenant, user.id, productId);
  }

  // -- Stock ------------------------------------------------------------------

  @Post('stock/receive')
  @RequirePermission('retail.manage')
  receive(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(ReceiveStockSchema) body: ReceiveStockInput) {
    return this.catalog.receiveStock(tenant, user.id, body);
  }

  @Post('stock/adjust')
  @RequirePermission('retail.manage')
  adjust(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(AdjustStockSchema) body: AdjustStockInput) {
    return this.catalog.adjustStock(tenant, user.id, body);
  }

  @Post('stock/transfer')
  @RequirePermission('retail.manage')
  transfer(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(TransferStockSchema) body: TransferStockInput) {
    return this.catalog.transferStock(tenant, user.id, body);
  }

  @Get('stock/movements')
  @RequirePermission('retail.view')
  movements(@Tenant() tenant: TenantContext, @ZodQuery(StockMovementsQuerySchema) query: StockMovementsQuery) {
    return this.catalog.listMovements(tenant, query);
  }

  @Get('stock/low')
  @RequirePermission('retail.view')
  async lowStock(@Tenant() tenant: TenantContext, @Query('branchId') branchId?: string) {
    return { items: await this.catalog.lowStock(tenant, branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined) };
  }

  // -- Sales ------------------------------------------------------------------

  @Post('sales')
  @RequirePermission('retail.sell')
  checkout(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CheckoutSchema) body: CheckoutInput) {
    return this.sales.checkout(tenant, user.id, body);
  }

  @Get('sales')
  @RequirePermission('retail.view')
  listSales(@Tenant() tenant: TenantContext, @ZodQuery(SalesQuerySchema) query: SalesQuery) {
    return this.sales.listSales(tenant, query);
  }

  @Get('sales/:saleId')
  @RequirePermission('retail.view')
  getSale(@Tenant() tenant: TenantContext, @Param('saleId', ParseUUIDPipe) saleId: string) {
    return this.sales.getSale(tenant, saleId);
  }

  @Post('sales/:saleId/refund')
  @RequirePermission('retail.refund')
  refund(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @ZodBody(RefundSaleSchema) body: RefundSaleInput,
  ) {
    return this.sales.refund(tenant, user.id, saleId, body);
  }

  @Post('sales/:saleId/void')
  @RequirePermission('retail.refund')
  voidSale(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @ZodBody(VoidSaleSchema) body: VoidSaleInput,
  ) {
    return this.sales.refund(tenant, user.id, saleId, { reason: body.reason }, { void: true });
  }

  // -- Report -------------------------------------------------------------------

  @Get('reports/sales')
  @RequirePermission('retail.view')
  async salesReport(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ReportRangeSchema) range: ReportRange,
    @ZodQuery(ReportFiltersSchema) filters: ReportFilters,
    @ZodQuery(RetailReportViewSchema) view: RetailReportViewQuery,
    @Res() res: Response,
  ) {
    const report = await this.sales.salesReport(tenant, range, filters.branchId);
    if (filters.format !== 'csv') return res.json(report);
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { defaultLocale: true } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="retail-${view.view}.csv"`);
    return res.send(this.reportCsv(report, view.view, studio.defaultLocale));
  }

  /** CSV headers come from the i18n catalogue in the studio's default language. */
  private reportCsv(report: RetailSalesReportDTO, view: RetailReportViewQuery['view'], locale: string): string {
    const t = createTranslator({ locale, messages: BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
    if (view === 'day') {
      return toCsv(
        [t('retail.csv.date'), t('retail.csv.saleCount'), t('retail.csv.gross'), t('retail.csv.refunded'), t('retail.csv.currency')],
        report.byDay.map((d) => [d.date, d.saleCount, d.gross, d.refunded, report.currency]),
      );
    }
    return toCsv(
      [
        t('retail.csv.product'),
        t('retail.csv.quantity'),
        t('retail.csv.refundedQuantity'),
        t('retail.csv.revenue'),
        t('retail.csv.cost'),
        t('retail.csv.margin'),
        t('retail.csv.currency'),
      ],
      report.byProduct.map((p) => [p.productName, p.quantity, p.refundedQuantity, p.revenue, p.cost, p.margin, report.currency]),
    );
  }
}
