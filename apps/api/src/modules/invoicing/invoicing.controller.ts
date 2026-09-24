import { Controller, Get, Header, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  BillingProfileInput,
  BillingProfileSchema,
  CancelInvoiceInput,
  CancelInvoiceSchema,
  InvoiceSettingsInput,
  InvoiceSettingsSchema,
  ListInvoicesQuery,
  ListInvoicesQuerySchema,
} from '@platform/shared';
import { InvoicingService } from './invoicing.service';
import { StudioScoped, RequirePermission, SelfService } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { toCsv } from '../../common/csv';
import type { AuthUser, TenantContext } from '../auth/tenant-context';

@Controller('invoicing/settings')
@StudioScoped()
export class InvoiceSettingsController {
  constructor(private invoicing: InvoicingService) {}

  @Get()
  @RequirePermission('finance.view')
  async get(@Tenant() tenant: TenantContext) {
    return this.invoicing.getSettings(tenant.studioId);
  }

  @Put()
  @RequirePermission('finance.manage')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(InvoiceSettingsSchema) body: InvoiceSettingsInput,
  ) {
    return this.invoicing.upsertSettings(tenant, user.id, body);
  }
}

@Controller('invoicing/billing-profiles')
@StudioScoped()
export class BillingProfilesController {
  constructor(private invoicing: InvoicingService) {}

  @Get('self')
  @SelfService()
  async getSelf(@Tenant() tenant: TenantContext) {
    return this.invoicing.getMyBillingProfile(tenant);
  }

  @Put('self')
  @SelfService()
  async updateSelf(@Tenant() tenant: TenantContext, @ZodBody(BillingProfileSchema) body: BillingProfileInput) {
    return this.invoicing.upsertMyBillingProfile(tenant, body);
  }

  @Get(':memberId')
  @RequirePermission('finance.view')
  async get(@Param('memberId') memberId: string, @Tenant() tenant: TenantContext) {
    return this.invoicing.getBillingProfile(tenant, memberId);
  }

  @Put(':memberId')
  @RequirePermission('finance.manage')
  async update(
    @Param('memberId') memberId: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(BillingProfileSchema) body: BillingProfileInput,
  ) {
    return this.invoicing.upsertBillingProfile(tenant, memberId, body);
  }
}

@Controller('invoices')
@StudioScoped()
export class InvoicesController {
  constructor(private invoicing: InvoicingService) {}

  @Get()
  @RequirePermission('finance.view')
  async list(@Tenant() tenant: TenantContext, @ZodQuery(ListInvoicesQuerySchema) query: ListInvoicesQuery) {
    return this.invoicing.list(tenant, query);
  }

  @Get('export')
  @RequirePermission('finance.view')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="faturalar.csv"')
  async export(@Tenant() tenant: TenantContext, @ZodQuery(ListInvoicesQuerySchema) query: ListInvoicesQuery) {
    const rows = await this.invoicing.exportCsv(tenant, query);
    return toCsv(
      ['Fatura No', 'Tarih', 'Durum', 'Ara Toplam', 'KDV', 'Toplam', 'Para Birimi', 'Sağlayıcı', 'Sağlayıcı UUID'],
      rows.map((r) => [r.number, r.issueDate.toISOString(), r.status, r.subtotal, r.vatAmount, r.total, r.currency, r.provider, r.providerUuid]),
    );
  }

  @Get('self')
  @SelfService()
  async listSelf(@Tenant() tenant: TenantContext) {
    return this.invoicing.listMine(tenant);
  }

  @Get('self/:id/download')
  @SelfService()
  async downloadSelf(@Param('id') id: string, @Tenant() tenant: TenantContext, @Res() res: Response) {
    const file = await this.invoicing.downloadPdf(tenant, id, true);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `inline; filename="fatura-${id}"`);
    res.send(file.body);
  }

  @Get(':id')
  @RequirePermission('finance.view')
  async getOne(@Param('id') id: string, @Tenant() tenant: TenantContext) {
    return this.invoicing.getOne(tenant, id);
  }

  @Get(':id/download')
  @RequirePermission('finance.view')
  async download(@Param('id') id: string, @Tenant() tenant: TenantContext, @Res() res: Response) {
    const file = await this.invoicing.downloadPdf(tenant, id, false);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `inline; filename="fatura-${id}"`);
    res.send(file.body);
  }

  @Post(':id/retry')
  @RequirePermission('finance.manage')
  async retry(@Param('id') id: string, @Tenant() tenant: TenantContext) {
    return this.invoicing.retry(tenant, id);
  }

  @Post(':id/cancel')
  @RequirePermission('finance.manage')
  async cancel(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CancelInvoiceSchema) body: CancelInvoiceInput,
  ) {
    return this.invoicing.cancel(tenant, user.id, id, body);
  }
}
