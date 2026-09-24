import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AdjustPayrollLineSchema, GeneratePayrollRunSchema, ListPayrollRunsSchema } from '@platform/shared';
import type { AdjustPayrollLineInput, GeneratePayrollRunInput, ListPayrollRunsInput } from '@platform/shared';
import { RequirePermission, SelfService, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PayrollService } from './payroll.service';

@Controller('payroll/studio/:studioId')
@StudioScoped()
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Post('runs')
  @RequirePermission('payroll.manage')
  async generate(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(GeneratePayrollRunSchema) body: GeneratePayrollRunInput) {
    return this.payroll.generate(tenant, user.id, body);
  }

  @Get('runs')
  @RequirePermission('commissions.view.all')
  async list(@Tenant() tenant: TenantContext, @ZodQuery(ListPayrollRunsSchema) query: ListPayrollRunsInput) {
    return this.payroll.list(tenant, query);
  }

  @Get('runs/:runId')
  @RequirePermission('commissions.view.all')
  async getRun(@Tenant() tenant: TenantContext, @Param('runId', ParseUUIDPipe) runId: string) {
    return this.payroll.getRun(tenant, runId);
  }

  @Get('runs/:runId/export.csv')
  @RequirePermission('commissions.view.all')
  async exportCsv(@Tenant() tenant: TenantContext, @Param('runId', ParseUUIDPipe) runId: string, @Res() res: Response) {
    const csv = await this.payroll.exportCsv(tenant, runId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hakedis-${runId}.csv"`);
    res.send(csv);
  }

  @Patch('runs/:runId/lines/:lineId/adjust')
  @RequirePermission('payroll.manage')
  async adjustLine(
    @Tenant() tenant: TenantContext,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @ZodBody(AdjustPayrollLineSchema) body: AdjustPayrollLineInput,
  ) {
    return this.payroll.adjustLine(tenant, runId, lineId, body);
  }

  @Post('runs/:runId/approve')
  @RequirePermission('payroll.manage')
  async approve(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('runId', ParseUUIDPipe) runId: string) {
    return this.payroll.approve(tenant, user.id, runId);
  }

  @Post('runs/:runId/mark-paid')
  @RequirePermission('payroll.manage')
  async markPaid(@Tenant() tenant: TenantContext, @Param('runId', ParseUUIDPipe) runId: string) {
    return this.payroll.markPaid(tenant, runId);
  }

  /** Trainer's own approved/paid lines. */
  @Get('me/lines')
  @SelfService()
  async myLines(@Tenant() tenant: TenantContext) {
    return this.payroll.myLines(tenant);
  }
}
