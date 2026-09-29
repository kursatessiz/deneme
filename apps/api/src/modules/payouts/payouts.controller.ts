import { BadRequestException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ListPayoutsQuerySchema, MatchPayoutItemSchema, PAYOUT_ERROR_CODES, PAYOUT_PROVIDERS, PayoutExportQuerySchema, UpdatePayoutConnectionSchema } from '@platform/shared';
import type { ListPayoutsQuery, MatchPayoutItemInput, PayoutExportQuery, PayoutProvider, UpdatePayoutConnectionInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { XLSX_CONTENT_TYPE } from '../accounting/accounting-xlsx';
import { PayoutsService } from './payouts.service';
import { PayoutSyncService } from './payout-sync.service';

/**
 * Bank payouts and reconciliation (G5d-2, docs/BANKA_ODEMELERI.md). Reading,
 * exporting and the item list need `payouts.view`; sync, manual matching and
 * the provider account setting need `payouts.manage`. The studio always
 * comes from the tenant guard; writes go through BillingWriteGuard (part of
 * @StudioScoped()), so restricted mode refuses them.
 */
@Controller('studios/:studioId/payouts')
@StudioScoped()
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly sync: PayoutSyncService,
  ) {}

  @Get()
  @RequirePermission('payouts.view')
  list(@Tenant() tenant: TenantContext, @ZodQuery(ListPayoutsQuerySchema) query: ListPayoutsQuery) {
    return this.payouts.list(tenant, query);
  }

  @Get('connections')
  @RequirePermission('payouts.view')
  async connections(@Tenant() tenant: TenantContext) {
    return { items: await this.sync.connections(tenant.studioId) };
  }

  @Patch('connections/:provider')
  @RequirePermission('payouts.manage')
  setAccount(@Tenant() tenant: TenantContext, @Param('provider') provider: string, @ZodBody(UpdatePayoutConnectionSchema) body: UpdatePayoutConnectionInput) {
    if (!(PAYOUT_PROVIDERS as readonly string[]).includes(provider)) throw new BadRequestException({ statusCode: 400, code: PAYOUT_ERROR_CODES.unknownProvider, message: 'Bilinmeyen sağlayıcı' });
    return this.sync.setAccount(tenant.studioId, provider as PayoutProvider, body.providerAccountId);
  }

  @Post('sync')
  @HttpCode(200)
  @RequirePermission('payouts.manage')
  async syncNow(@Tenant() tenant: TenantContext) {
    return { results: await this.sync.syncStudio(tenant.studioId) };
  }

  @Get('export')
  @RequirePermission('payouts.view')
  async export(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodQuery(PayoutExportQuerySchema) query: PayoutExportQuery, @Res() res: Response) {
    const result = await this.payouts.export(tenant, user.id, query);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    if (result.format === 'xlsx') {
      res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
      return res.send(result.body);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(result.body);
  }

  @Get(':id')
  @RequirePermission('payouts.view')
  detail(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.detail(tenant, id);
  }

  @Get(':id/items/:itemId/candidates')
  @RequirePermission('payouts.manage')
  async candidates(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return { items: await this.payouts.candidates(tenant, id, itemId) };
  }

  @Post(':id/items/:itemId/match')
  @HttpCode(200)
  @RequirePermission('payouts.manage')
  match(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @ZodBody(MatchPayoutItemSchema) body: MatchPayoutItemInput,
  ) {
    return this.payouts.match(tenant, user.id, id, itemId, body.paymentId);
  }

  @Delete(':id/items/:itemId/match')
  @RequirePermission('payouts.manage')
  unmatch(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.payouts.unmatch(tenant, user.id, id, itemId);
  }
}
