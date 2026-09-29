import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AccountingExportQuerySchema } from '@platform/shared';
import type { AccountingExportQuery } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodQuery } from '../../common/zod-body.pipe';
import { AccountingService } from './accounting.service';

/**
 * Accounting export (G3c-3, docs/MUHASEBE.md). The studio always comes from
 * the tenant guard (`:studioId` is checked against the caller's membership);
 * branch-restricted staff only export their branches.
 */
@Controller('studios/:studioId/accounting')
@StudioScoped()
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('export')
  @RequirePermission('accounting.export')
  async export(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodQuery(AccountingExportQuerySchema) query: AccountingExportQuery, @Res() res: Response) {
    const result = await this.accounting.export(tenant, user.id, query);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    if (result.format === 'json') return res.json(result.body);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(result.body);
  }
}
