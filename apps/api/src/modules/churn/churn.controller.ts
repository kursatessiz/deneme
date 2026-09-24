import { Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ChurnListQuerySchema, ChurnRecomputeSchema, MarkContactedSchema, SnoozeRiskSchema } from '@platform/shared';
import type { ChurnListQuery, ChurnRecomputeInput, MarkContactedInput, SnoozeRiskInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ChurnService } from './churn.service';
import { churnMembersToCsv } from './churn.csv';

@Controller('churn/studio/:studioId')
@StudioScoped()
export class ChurnController {
  constructor(
    private readonly churn: ChurnService,
    private readonly config: ConfigService,
  ) {}

  @Get('members')
  @RequirePermission('reports.view')
  async list(@Tenant() tenant: TenantContext, @ZodQuery(ChurnListQuerySchema) query: ChurnListQuery, @Res() res: Response) {
    if (query.format === 'csv') {
      const items = await this.churn.findAllForExport(tenant, query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="riskli-uyeler.csv"');
      return res.send(churnMembersToCsv(items));
    }
    return res.json(await this.churn.findAll(tenant, query));
  }

  @Get('summary')
  @RequirePermission('reports.view')
  async summary(@Tenant() tenant: TenantContext) {
    return this.churn.summary(tenant);
  }

  @Get('members/:memberId')
  @RequirePermission('reports.view')
  async findOne(@Tenant() tenant: TenantContext, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.churn.findById(tenant, memberId);
  }

  @Post('recompute')
  @RequirePermission('members.manage')
  async recompute(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(ChurnRecomputeSchema) body: ChurnRecomputeInput) {
    // `now` lets the e2e suite compute against deterministic fixture dates;
    // it is silently ignored outside NODE_ENV=test so it can never be used
    // to game production data.
    const isTest = this.config.get<string>('NODE_ENV') === 'test';
    const now = isTest && body?.now ? new Date(body.now) : undefined;
    return this.churn.recomputeStudioRateLimited(tenant, user.id, now);
  }

  @Post('members/:memberId/contacted')
  @RequirePermission('members.manage')
  async markContacted(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @ZodBody(MarkContactedSchema) body: MarkContactedInput,
  ) {
    return this.churn.markContacted(tenant, memberId, user.id, body);
  }

  @Post('members/:memberId/snooze')
  @RequirePermission('members.manage')
  async snooze(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @ZodBody(SnoozeRiskSchema) body: SnoozeRiskInput,
  ) {
    return this.churn.snooze(tenant, memberId, user.id, body.days);
  }
}
