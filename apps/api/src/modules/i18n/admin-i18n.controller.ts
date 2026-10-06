import { BadRequestException, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  CreateLanguageSchema,
  ImportLanguagePackSchema,
  LocaleCodeSchema,
  ReviewTranslationsSchema,
  TranslationEntriesQuerySchema,
  UpdateLanguageSchema,
  UpsertTranslationSchema,
  type CreateLanguageInput,
  type ImportLanguagePackInput,
  type ReviewTranslationsInput,
  type TranslationEntriesQuery,
  type UpdateLanguageInput,
  type UpsertTranslationInput,
} from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { I18nService } from './i18n.service';
import { apiError } from '../../common/api-error';

function packFilename(code: string, format: 'json' | 'csv'): string {
  const date = new Date().toISOString().slice(0, 10);
  return `dil-paketi-${code}-${date}.${format}`;
}

/**
 * Super-admin CMS for platform languages and their translated strings. See
 * docs/I18N.md for the download -> translate -> upload workflow.
 */
@Controller('admin/i18n')
@SuperAdminOnly()
export class AdminI18nController {
  constructor(private readonly i18n: I18nService) {}

  @Get('languages')
  async listLanguages() {
    return { items: await this.i18n.adminListLanguages() };
  }

  @Post('languages')
  async createLanguage(@CurrentUser() user: AuthUser, @ZodBody(CreateLanguageSchema) body: CreateLanguageInput) {
    return this.i18n.adminCreateLanguage(user.id, body);
  }

  @Put('languages/:code')
  async updateLanguage(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @ZodBody(UpdateLanguageSchema) body: UpdateLanguageInput,
  ) {
    return this.i18n.adminUpdateLanguage(user.id, code, body);
  }

  @Delete('languages/:code')
  @HttpCode(204)
  async deleteLanguage(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    await this.i18n.adminDeleteLanguage(user.id, code);
  }

  @Get('languages/:code/entries')
  async listEntries(@Param('code') code: string, @ZodQuery(TranslationEntriesQuerySchema) query: TranslationEntriesQuery) {
    return { items: await this.i18n.adminListEntries(code, query) };
  }

  @Put('languages/:code/entries/:key')
  async upsertEntry(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('key') key: string,
    @ZodBody(UpsertTranslationSchema) body: UpsertTranslationInput,
  ) {
    return this.i18n.adminUpsertEntry(user.id, code, key, body.value);
  }

  /** Approve AI translations (G3b): the listed keys, or all unreviewed ones of the language. */
  @Post('languages/:code/review')
  @HttpCode(200)
  async review(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @ZodBody(ReviewTranslationsSchema) body: ReviewTranslationsInput,
  ) {
    return this.i18n.adminReview(user.id, code, body);
  }

  @Get('languages/:code/export')
  async exportLanguage(@Param('code') code: string, @Query('format') format: string | undefined, @Res() res: Response) {
    if (!LocaleCodeSchema.safeParse(code).success) throw new BadRequestException(apiError('apiErrors.i18n.invalidLanguageCode'));
    const fmt = format === 'csv' ? 'csv' : 'json';
    const { locale, name, nativeName, messages } = await this.i18n.adminExport(code);
    const body =
      fmt === 'csv'
        ? this.i18n.buildPackCsv(locale, name, nativeName, messages)
        : this.i18n.buildPackJson(locale, name, nativeName, messages);
    res.setHeader('Content-Type', fmt === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${packFilename(locale, fmt)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Sent as bytes with an explicit type and attachment disposition: a
    // download, never a page the browser renders.
    return res.send(Buffer.from(body, 'utf8'));
  }

  @Post('languages/:code/import')
  async importLanguage(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @ZodBody(ImportLanguagePackSchema) body: ImportLanguagePackInput,
  ) {
    return this.i18n.adminImport(user.id, code, body);
  }
}
