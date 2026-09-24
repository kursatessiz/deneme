import { Controller, Get, Post, Put, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import {
  CreateVideoContentSchema,
  CreateVideoContentInput,
  UpdateVideoContentSchema,
  UpdateVideoContentInput,
  ListVideoContentQuerySchema,
  ListVideoContentQueryInput,
  RecordVideoProgressSchema,
  RecordVideoProgressInput,
  StartWatchingSchema,
  StartWatchingInput,
} from '@platform/shared';
import { toCsv } from '../../common/csv';
import { StudioScoped, RequirePermission, SelfService } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { TenantContext } from '../auth/tenant-context';
import { ContentService } from './content.service';

@Controller('video/content')
@StudioScoped()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Post('studio/:studioId')
  @RequirePermission('content.manage')
  async create(@Tenant() tenant: TenantContext, @ZodBody(CreateVideoContentSchema) body: CreateVideoContentInput) {
    return this.content.create(tenant, body);
  }

  @Put('studio/:studioId/:contentId')
  @RequirePermission('content.manage')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @ZodBody(UpdateVideoContentSchema) body: UpdateVideoContentInput,
  ) {
    return this.content.update(tenant, contentId, body);
  }

  @Post('studio/:studioId/:contentId/publish')
  @RequirePermission('content.manage')
  async publish(@Tenant() tenant: TenantContext, @Param('contentId', ParseUUIDPipe) contentId: string) {
    return this.content.setPublished(tenant, contentId, true);
  }

  @Post('studio/:studioId/:contentId/unpublish')
  @RequirePermission('content.manage')
  async unpublish(@Tenant() tenant: TenantContext, @Param('contentId', ParseUUIDPipe) contentId: string) {
    return this.content.setPublished(tenant, contentId, false);
  }

  @Get('studio/:studioId')
  @RequirePermission('content.view')
  async listForStaff(@Tenant() tenant: TenantContext, @ZodQuery(ListVideoContentQuerySchema) query: ListVideoContentQueryInput) {
    return this.content.listForStaff(tenant, query);
  }

  @Get('studio/:studioId/reports')
  @RequirePermission('content.view')
  async reports(@Tenant() tenant: TenantContext, @Res() res: Response) {
    const stats = await this.content.stats(tenant);
    if (res.req.query.format === 'csv') {
      const csv = toCsv(
        ['İçerik', 'İzlenme', 'Tamamlanma', 'Tekil İzleyici'],
        stats.map((s) => [s.title, s.views, s.completions, s.uniqueViewers]),
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="video-icerik-raporu.csv"');
      return res.send(csv);
    }
    return res.json(stats);
  }

  @Get('self')
  @SelfService()
  async listForMember(@Tenant() tenant: TenantContext, @ZodQuery(ListVideoContentQuerySchema) query: ListVideoContentQueryInput) {
    return this.content.listForMember(tenant, query);
  }

  @Post('self/:contentId/start')
  @SelfService()
  async start(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @ZodBody(StartWatchingSchema) body: StartWatchingInput,
  ) {
    return this.content.start(tenant, contentId, body.memberPackageId);
  }

  @Post('self/:contentId/progress')
  @SelfService()
  async progress(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @ZodBody(RecordVideoProgressSchema) body: RecordVideoProgressInput,
  ) {
    return this.content.recordProgress(tenant, contentId, body);
  }
}
