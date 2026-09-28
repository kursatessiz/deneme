import { Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TouchpointInputSchema } from '@platform/shared';
import type { TouchpointInput } from '@platform/shared';
import { ZodBody } from '../../../common/zod-body.pipe';
import { TrackingService } from './tracking.service';
import { TrackingRateLimitGuard } from './tracking-rate-limit.guard';

/**
 * Public, unauthenticated visitor tracking (docs/CRM_VE_ATIF.md). The slug
 * `platform` is the platform's own site. Always 204 once the body is valid:
 * an unknown slug, a bot, missing consent and a stored touchpoint look the
 * same from outside, so nothing about tenants can be probed here.
 *
 * There is deliberately no public identify endpoint: identification only
 * happens server side, when a form, booking or sign-up that creates or
 * finds a contact carries the visitor id (see readVisitorId).
 */
@Controller('track')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post(':studioSlug/touchpoint')
  @HttpCode(204)
  @UseGuards(TrackingRateLimitGuard)
  async touchpoint(
    @Param('studioSlug') studioSlug: string,
    @ZodBody(TouchpointInputSchema) body: TouchpointInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.tracking.recordTouchpoint(studioSlug, body, { userAgent: req.headers['user-agent'], headers: req.headers });
  }
}
