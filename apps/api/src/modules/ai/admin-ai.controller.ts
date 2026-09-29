import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  GlossaryTermSchema,
  SetAiApiKeySchema,
  SetTenantAiLimitSchema,
  StartTranslationJobSchema,
  UpdateAiSettingsSchema,
  AiUsageQuerySchema,
  type AiUsageQuery,
  type GlossaryTermInput,
  type SetAiApiKeyInput,
  type SetTenantAiLimitInput,
  type StartTranslationJobInput,
  type UpdateAiSettingsInput,
} from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { AiSettingsService } from './ai-settings.service';
import { AiUsageService } from './ai-usage.service';
import { AiService } from './ai.service';
import { AiQueueService } from './translation/ai-queue.service';
import { TranslationEngineService } from './translation/translation-engine.service';
import { GlossaryService } from './translation/glossary.service';

/**
 * Super-admin AI settings (docs/YAPAY_ZEKA.md): provider key (write-only,
 * never returned), test connection, model per task, prices, budgets and the
 * usage dashboard; plus translation job status and cancel.
 */
@Controller('admin/ai')
@SuperAdminOnly()
export class AdminAiController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly usage: AiUsageService,
    private readonly ai: AiService,
    private readonly queue: AiQueueService,
    private readonly engine: TranslationEngineService,
  ) {}

  private dto() {
    return this.settings.toDTO(this.queue.enabled ? 'QUEUE' : 'HEARTBEAT');
  }

  @Get('settings')
  getSettings() {
    return this.dto();
  }

  @Patch('settings')
  async updateSettings(@CurrentUser() user: AuthUser, @ZodBody(UpdateAiSettingsSchema) body: UpdateAiSettingsInput) {
    await this.settings.update(user.id, body);
    return this.dto();
  }

  @Put('settings/key')
  async setKey(@CurrentUser() user: AuthUser, @ZodBody(SetAiApiKeySchema) body: SetAiApiKeyInput) {
    await this.settings.setKey(user.id, body.apiKey);
    return this.dto();
  }

  @Delete('settings/key')
  async removeKey(@CurrentUser() user: AuthUser) {
    await this.settings.removeKey(user.id);
    return this.dto();
  }

  @Post('settings/test')
  @HttpCode(200)
  test(@CurrentUser() user: AuthUser) {
    return this.ai.testConnection(user.id);
  }

  @Get('usage')
  usageDashboard(@ZodQuery(AiUsageQuerySchema) query: AiUsageQuery) {
    return this.usage.dashboard(query.months, new Date());
  }

  @Put('tenants/:studioId/limit')
  setTenantLimit(
    @CurrentUser() user: AuthUser,
    @Param('studioId', ParseUUIDPipe) studioId: string,
    @ZodBody(SetTenantAiLimitSchema) body: SetTenantAiLimitInput,
  ) {
    return this.usage.setTenantLimit(user.id, studioId, body.monthlyBudgetCents);
  }

  @Get('translation-jobs/:jobId')
  getJob(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.engine.get(jobId);
  }

  @Post('translation-jobs/:jobId/cancel')
  @HttpCode(200)
  cancelJob(@CurrentUser() user: AuthUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.engine.cancel(user.id, jobId);
  }
}

/** "Translate with AI" and the glossary, next to the language CMS routes. */
@Controller('admin/i18n/languages/:code')
@SuperAdminOnly()
export class AdminAiTranslationController {
  constructor(
    private readonly engine: TranslationEngineService,
    private readonly glossary: GlossaryService,
  ) {}

  @Post('ai-translate')
  start(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @ZodBody(StartTranslationJobSchema) body: StartTranslationJobInput,
  ) {
    return this.engine.start(user.id, code, body);
  }

  @Get('ai-translate/jobs')
  async jobs(@Param('code') code: string) {
    return { items: await this.engine.list(code) };
  }

  @Get('glossary')
  async listGlossary(@Param('code') code: string) {
    return { items: await this.glossary.list(code) };
  }

  @Post('glossary')
  upsertGlossary(@CurrentUser() user: AuthUser, @Param('code') code: string, @ZodBody(GlossaryTermSchema) body: GlossaryTermInput) {
    return this.glossary.upsert(user.id, code, body);
  }

  @Delete('glossary/:termId')
  @HttpCode(204)
  async deleteGlossary(@CurrentUser() user: AuthUser, @Param('code') code: string, @Param('termId', ParseUUIDPipe) termId: string) {
    await this.glossary.remove(user.id, code, termId);
  }
}

