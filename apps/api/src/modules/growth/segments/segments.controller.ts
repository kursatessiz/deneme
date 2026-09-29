import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  CreateSegmentSchema,
  SegmentContactsQuerySchema,
  SegmentMembersSchema,
  SegmentPreviewSchema,
  UpdateSegmentSchema,
} from '@platform/shared';
import type {
  CreateSegmentInput,
  SegmentContactsQuery,
  SegmentMembersInput,
  SegmentPreviewInput,
  UpdateSegmentInput,
} from '@platform/shared';
import { RequirePermission, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import { Tenant } from '../../auth/decorators/current-user.decorator';
import type { TenantContext } from '../../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../../common/zod-body.pipe';
import { SegmentsService, toSegmentDto } from './segments.service';

/** Segments (G2a). The studio always comes from the tenant guard, never from the body. */
@Controller('studios/:studioId/segments')
@StudioScoped()
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get()
  @RequirePermission('segments.view')
  async list(@Tenant() tenant: TenantContext) {
    return { items: await this.segments.list(tenant.studioId) };
  }

  @Get('fields')
  @RequirePermission('segments.view')
  fields(@Tenant() tenant: TenantContext) {
    return this.segments.fieldCatalogue(tenant.studioId);
  }

  @Post('preview')
  @RequirePermission('segments.view')
  preview(@Tenant() tenant: TenantContext, @ZodBody(SegmentPreviewSchema) body: SegmentPreviewInput) {
    return this.segments.preview(tenant.studioId, body.rules);
  }

  @Post()
  @RequirePermission('segments.manage')
  create(@Tenant() tenant: TenantContext, @ZodBody(CreateSegmentSchema) body: CreateSegmentInput) {
    return this.segments.create(tenant.studioId, tenant.membershipId, body);
  }

  @Get(':segmentId')
  @RequirePermission('segments.view')
  async get(@Tenant() tenant: TenantContext, @Param('segmentId', ParseUUIDPipe) segmentId: string) {
    return toSegmentDto(await this.segments.get(tenant.studioId, segmentId));
  }

  @Patch(':segmentId')
  @RequirePermission('segments.manage')
  update(
    @Tenant() tenant: TenantContext,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @ZodBody(UpdateSegmentSchema) body: UpdateSegmentInput,
  ) {
    return this.segments.update(tenant.studioId, segmentId, body);
  }

  @Delete(':segmentId')
  @RequirePermission('segments.manage')
  archive(@Tenant() tenant: TenantContext, @Param('segmentId', ParseUUIDPipe) segmentId: string) {
    return this.segments.archive(tenant.studioId, segmentId);
  }

  @Post(':segmentId/refresh')
  @RequirePermission('segments.manage')
  refresh(@Tenant() tenant: TenantContext, @Param('segmentId', ParseUUIDPipe) segmentId: string) {
    return this.segments.refreshById(tenant.studioId, segmentId);
  }

  @Get(':segmentId/contacts')
  @RequirePermission('segments.view')
  contacts(
    @Tenant() tenant: TenantContext,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @ZodQuery(SegmentContactsQuerySchema) query: SegmentContactsQuery,
  ) {
    return this.segments.contacts(tenant.studioId, segmentId, query);
  }

  @Post(':segmentId/members')
  @RequirePermission('segments.manage')
  members(
    @Tenant() tenant: TenantContext,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @ZodBody(SegmentMembersSchema) body: SegmentMembersInput,
  ) {
    return this.segments.updateMembers(tenant.studioId, segmentId, body);
  }
}
