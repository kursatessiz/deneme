import { Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ErrorGroupListQuerySchema, ErrorGroupNoteSchema, ErrorGroupResolveSchema } from '@platform/shared';
import type { ErrorGroupListQuery } from '@platform/shared';
import { z } from 'zod';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { ErrorQueryService } from './error-query.service';

/** Super admin: every error group on the platform (docs/HATA_RAPORLAMA.md). */
@Controller('admin/errors')
@SuperAdminOnly()
export class AdminErrorsController {
  constructor(private readonly errors: ErrorQueryService) {}

  @Get()
  list(@ZodQuery(ErrorGroupListQuerySchema) query: ErrorGroupListQuery) {
    return this.errors.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.errors.detail(id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@Param('id') id: string, @ZodBody(ErrorGroupResolveSchema) body: z.infer<typeof ErrorGroupResolveSchema>, @CurrentUser() user: AuthUser) {
    return this.errors.act(id, 'resolve', user.id, body.release);
  }

  @Post(':id/ignore')
  @HttpCode(200)
  ignore(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.errors.act(id, 'ignore', user.id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.errors.act(id, 'reopen', user.id);
  }

  @Patch(':id/note')
  note(@Param('id') id: string, @ZodBody(ErrorGroupNoteSchema) body: z.infer<typeof ErrorGroupNoteSchema>, @CurrentUser() user: AuthUser) {
    return this.errors.setNote(id, body.note, user.id);
  }
}

/** Tenant owner view: only this studio's occurrences, without stack traces. */
@Controller('studios/:studioId/errors')
@StudioScoped()
export class StudioErrorsController {
  constructor(private readonly errors: ErrorQueryService) {}

  @Get()
  @RequirePermission('errors.view')
  list(@Tenant() tenant: TenantContext) {
    return this.errors.forStudio(tenant.studioId);
  }
}
