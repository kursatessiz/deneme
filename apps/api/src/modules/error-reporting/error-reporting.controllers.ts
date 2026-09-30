import { Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ErrorAlertListQuerySchema,
  ErrorGroupListQuerySchema,
  ErrorGroupMergeSchema,
  ErrorGroupNoteSchema,
  ErrorGroupResolveSchema,
  ErrorSettingsUpdateSchema,
  StudioErrorSettingsUpdateSchema,
} from '@platform/shared';
import type { ErrorAlertListQuery, ErrorGroupListQuery } from '@platform/shared';
import { z } from 'zod';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { ErrorQueryService } from './error-query.service';
import { ErrorMergeService } from './error-merge.service';
import { ErrorAlertRecordsService } from './error-alert-records.service';
import { ErrorSettingsService } from './error-settings.service';
import { ErrorStudioSettingsService } from './error-studio-settings.service';

/**
 * Super admin: stored alerts (spike, new group, regression). Registered before
 * AdminErrorsController so `alerts` is not read as a group id.
 */
@Controller('admin/errors/alerts')
@SuperAdminOnly()
export class AdminErrorAlertsController {
  constructor(private readonly alerts: ErrorAlertRecordsService) {}

  @Get()
  list(@ZodQuery(ErrorAlertListQuerySchema) query: ErrorAlertListQuery) {
    return this.alerts.list(query);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  acknowledge(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.alerts.acknowledge(id, user.id);
  }
}

/** Super admin: spike thresholds, cooldown and alert sink destinations. Registered before AdminErrorsController. */
@Controller('admin/errors/settings')
@SuperAdminOnly()
export class AdminErrorSettingsController {
  constructor(private readonly settings: ErrorSettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Patch()
  update(@ZodBody(ErrorSettingsUpdateSchema) body: z.infer<typeof ErrorSettingsUpdateSchema>, @CurrentUser() user: AuthUser) {
    return this.settings.update(user.id, body);
  }
}

/** Super admin: every error group on the platform (docs/HATA_RAPORLAMA.md). */
@Controller('admin/errors')
@SuperAdminOnly()
export class AdminErrorsController {
  constructor(
    private readonly errors: ErrorQueryService,
    private readonly merges: ErrorMergeService,
  ) {}

  /** H3: folds this group into the target; its fingerprint becomes an alias of the target. */
  @Post('groups/:id/merge')
  @HttpCode(200)
  merge(@Param('id') id: string, @ZodBody(ErrorGroupMergeSchema) body: z.infer<typeof ErrorGroupMergeSchema>, @CurrentUser() user: AuthUser) {
    return this.merges.merge(id, body.targetId, user.id);
  }

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
  constructor(
    private readonly errors: ErrorQueryService,
    private readonly studioSettings: ErrorStudioSettingsService,
  ) {}

  /** H3: whether the owner is e-mailed about new error groups and spikes that affect this studio. */
  @Get('settings')
  @RequirePermission('errors.view')
  getSettings(@Tenant() tenant: TenantContext) {
    return this.studioSettings.get(tenant.studioId);
  }

  @Patch('settings')
  @RequirePermission('studio.settings.manage')
  updateSettings(
    @Tenant() tenant: TenantContext,
    @ZodBody(StudioErrorSettingsUpdateSchema) body: z.infer<typeof StudioErrorSettingsUpdateSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.studioSettings.update(tenant.studioId, user.id, body.ownerNotify);
  }

  @Get()
  @RequirePermission('errors.view')
  list(@Tenant() tenant: TenantContext) {
    return this.errors.forStudio(tenant.studioId);
  }
}
