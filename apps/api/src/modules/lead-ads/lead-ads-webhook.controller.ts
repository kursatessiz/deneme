import { Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LEAD_ADS_WEBHOOK_PATH } from '@platform/shared';
import { LeadAdsAdminService } from './lead-ads-admin.service';
import { LeadAdsService } from './lead-ads.service';

/**
 * Meta Lead Ads webhook (M4c): the GET subscription handshake (verify token
 * from the platform settings, super admin only) and signed POST
 * notifications. The POST body arrives raw (see common/body-parsers.ts) so
 * X-Hub-Signature-256 is checked against the exact bytes Meta signed, with
 * the app secret stored encrypted on the Meta AdConnection of the page the
 * notification names. Public by nature: nothing is trusted before that check.
 */
@Controller(LEAD_ADS_WEBHOOK_PATH)
export class LeadAdsWebhookController {
  constructor(
    private readonly admin: LeadAdsAdminService,
    private readonly leadAds: LeadAdsService,
  ) {}

  @Get()
  async verify(
    @Query('hub.mode') mode: unknown,
    @Query('hub.verify_token') token: unknown,
    @Query('hub.challenge') challenge: unknown,
    @Res() res: Response,
  ): Promise<void> {
    if (mode !== 'subscribe' || typeof token !== 'string' || !(await this.admin.isValidVerifyToken(token))) throw new ForbiddenException();
    // Meta's challenge is an integer; echo it back as a number, never as raw request text.
    if (typeof challenge !== 'string' || !/^\d{1,15}$/.test(challenge)) throw new ForbiddenException();
    res.status(200).type('text/plain').set('X-Content-Type-Options', 'nosniff').send(String(Number(challenge)));
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request, @Headers('x-hub-signature-256') signature: string | undefined): Promise<{ received: true }> {
    const raw: unknown = req.body;
    if (!Buffer.isBuffer(raw)) throw new UnauthorizedException();
    await this.leadAds.receive(raw, signature);
    return { received: true };
  }
}
