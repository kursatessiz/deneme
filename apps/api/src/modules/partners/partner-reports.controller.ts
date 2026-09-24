import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { PartnerReportRangeSchema, type PartnerReportRange } from '@platform/shared';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { ZodQuery } from '../../common/zod-body.pipe';
import type { TenantContext } from '../auth/tenant-context';
import { PartnerReportsService } from './partner-reports.service';
import { partnerVisitsToCsv } from './partner-reports.csv';

@Controller('partners/reports')
@StudioScoped()
export class PartnerReportsController {
  constructor(private readonly reports: PartnerReportsService) {}

  @Get('visits')
  @RequirePermission('reports.view')
  async visits(@Tenant() tenant: TenantContext, @ZodQuery(PartnerReportRangeSchema) range: PartnerReportRange, @Res() res: Response) {
    const rows = await this.reports.visits(
      tenant,
      range.from ? new Date(range.from) : undefined,
      range.to ? new Date(range.to) : undefined,
    );
    if (range.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="partner-ziyaret-raporu.csv"');
      return res.send(partnerVisitsToCsv(rows));
    }
    return res.json(rows);
  }
}
