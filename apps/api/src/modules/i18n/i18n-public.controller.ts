import { Controller, Get, Headers, HttpCode, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { PublicLanguagesDTO } from '@platform/shared';
import { I18nService } from './i18n.service';
import { I18nPublicRateLimitGuard } from './i18n-public-rate-limit.guard';
import { apiError } from '../../common/api-error';

/**
 * Unauthenticated i18n reads consumed by web and mobile at boot: the
 * language list and each locale's effective messages (bundled + CMS
 * overrides). No tenant context -- languages are platform data.
 */
@Controller('i18n')
@UseGuards(I18nPublicRateLimitGuard)
export class I18nPublicController {
  constructor(private readonly i18n: I18nService) {}

  @Get('languages')
  async getLanguages(): Promise<PublicLanguagesDTO> {
    return this.i18n.getPublicLanguages();
  }

  @Get('messages/:locale')
  @HttpCode(200)
  async getMessages(
    @Param('locale') locale: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.i18n.getLocaleMessages(locale);
    if (!result) throw new NotFoundException(apiError('apiErrors.i18n.languageNotFoundOrDisabled', { locale: locale }));

    res.setHeader('ETag', result.version);
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (ifNoneMatch && ifNoneMatch === result.version) {
      res.status(304);
      return;
    }
    return result;
  }
}
