import { Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { readVisitorId } from '../../crm/tracking/tracking-utils';
import { TrackingService } from './tracking.service';
import { apiError } from '../../../common/api-error';

/** Transparent 1x1 GIF. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Public, unauthenticated message tracking (docs/MESAJLASMA.md, "İzleme").
 * Every route takes a signed token (tracking-tokens.ts) that only
 * references a stored row; nothing here accepts a URL from the request.
 */
@Controller('m')
export class MessageTrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly config: ConfigService,
  ) {}

  @Get('o/:token')
  async open(@Param('token') token: string, @Headers('user-agent') userAgent: string | undefined, @Res() res: Response): Promise<void> {
    await this.tracking.recordOpen(token.replace(/\.gif$/, ''), userAgent);
    res.set({
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Content-Length': String(PIXEL.length),
    });
    res.status(200).end(PIXEL);
  }

  /** Direct redirect (API on the site's domain: the pw_vid cookie is readable here). */
  @Get('c/:token')
  async clickRedirect(@Param('token') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const url = await this.tracking.recordClick(token, req.headers['user-agent'], readVisitorId(req.headers));
    const fallback = this.config.get<string>('PUBLIC_APP_URL', 'http://localhost:3000');
    res.set('Cache-Control', 'no-store');
    res.redirect(302, url ?? fallback);
  }

  /** Web app route handler: it forwards the visitor id (X-PW-VID) and performs the redirect itself. */
  @Post('c/:token')
  @HttpCode(200)
  async click(@Param('token') token: string, @Req() req: Request): Promise<{ url: string }> {
    const url = await this.tracking.recordClick(token, req.headers['user-agent'], readVisitorId(req.headers));
    if (!url) throw new NotFoundException(apiError('apiErrors.messaging.connectionNotFound'));
    return { url };
  }

  @Get('u/:token')
  async unsubscribeInfo(@Param('token') token: string) {
    const info = await this.tracking.unsubscribeInfo(token);
    if (!info) throw new NotFoundException(apiError('apiErrors.messaging.connectionInvalid'));
    return info;
  }

  /** RFC 8058 one-click (List-Unsubscribe-Post) and the web page's button. Idempotent. */
  @Post('u/:token')
  @HttpCode(200)
  async unsubscribe(@Param('token') token: string) {
    const result = await this.tracking.unsubscribe(token);
    if (!result) throw new NotFoundException(apiError('apiErrors.messaging.connectionInvalid'));
    return result;
  }
}
