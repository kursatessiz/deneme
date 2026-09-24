import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import {
  ReportFiltersSchema,
  ReportRangeSchema,
  RevenueGranularitySchema,
} from '@platform/shared';
import type { ReportFilters, ReportRange, RevenueGranularityQuery } from '@platform/shared';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { ZodQuery } from '../../common/zod-body.pipe';
import type { TenantContext } from '../auth/tenant-context';
import { ReportsService } from './reports.service';
import {
  cohortsToCsv,
  membersToCsv,
  occupancyToCsv,
  renewalToCsv,
  revenueToCsv,
  trainersToCsv,
} from './reports.csv';

@Controller('reports')
@StudioScoped()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('studio/:studioId/occupancy')
  @RequirePermission('reports.view')
  async occupancy(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ReportRangeSchema) range: ReportRange,
    @ZodQuery(ReportFiltersSchema) filters: ReportFilters,
    @Res() res: Response,
  ) {
    const report = await this.reports.occupancy(tenant, range, filters);
    return this.respond(res, filters, report, () => occupancyToCsv(report), 'doluluk-raporu');
  }

  @Get('studio/:studioId/revenue')
  @RequirePermission('reports.view')
  async revenue(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ReportRangeSchema) range: ReportRange,
    @ZodQuery(ReportFiltersSchema) filters: ReportFilters,
    @ZodQuery(RevenueGranularitySchema) granularityQuery: RevenueGranularityQuery,
    @Res() res: Response,
  ) {
    const report = await this.reports.revenue(tenant, range, filters, granularityQuery.granularity);
    return this.respond(res, filters, report, () => revenueToCsv(report), 'gelir-raporu');
  }

  @Get('studio/:studioId/members')
  @RequirePermission('reports.view')
  async members(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ReportRangeSchema) range: ReportRange,
    @ZodQuery(ReportFiltersSchema) filters: ReportFilters,
    @Res() res: Response,
  ) {
    const report = await this.reports.members(tenant, range, filters);
    return this.respond(res, filters, report, () => membersToCsv(report), 'uye-raporu');
  }

  @Get('studio/:studioId/renewal')
  @RequirePermission('reports.view')
  async renewal(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ReportRangeSchema) range: ReportRange,
    @ZodQuery(ReportFiltersSchema) filters: ReportFilters,
    @Res() res: Response,
  ) {
    const report = await this.reports.renewal(tenant, range, filters);
    return this.respond(res, filters, report, () => renewalToCsv(report), 'yenileme-raporu');
  }

  @Get('studio/:studioId/cohorts')
  @RequirePermission('reports.view')
  async cohorts(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ReportFiltersSchema) filters: ReportFilters,
    @Res() res: Response,
  ) {
    const report = await this.reports.cohorts(tenant, filters);
    return this.respond(res, filters, report, () => cohortsToCsv(report), 'kohort-raporu');
  }

  @Get('studio/:studioId/trainers')
  @RequirePermission('reports.view')
  async trainers(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ReportRangeSchema) range: ReportRange,
    @ZodQuery(ReportFiltersSchema) filters: ReportFilters,
    @Res() res: Response,
  ) {
    const report = await this.reports.trainers(tenant, range, filters);
    return this.respond(res, filters, report, () => trainersToCsv(report), 'egitmen-raporu');
  }

  private respond<T>(res: Response, filters: ReportFilters, json: T, toCsv: () => string, filenameBase: string) {
    if (filters.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
      return res.send(toCsv());
    }
    return res.json(json);
  }
}
