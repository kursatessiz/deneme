import { Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PublicLeadFormSchema, PublicLeadFormInput } from '@platform/shared';
import { ZodBody } from '../../../common/zod-body.pipe';
import { LeadsCompatService } from './leads-compat.service';
import { LeadsPublicRateLimitGuard } from './leads-public-rate-limit.guard';
import { readVisitorId } from '../tracking/tracking-utils';

/**
 * Unauthenticated web-form endpoint, meant to be embedded on the tenant's
 * own website (see docs/LEADS.md). No JWT, no tenant guard: the studio is
 * resolved from the slug in the path, and the response is a constant 202
 * whatever happens, so the slug cannot be probed for which studios exist.
 *
 * Since G1b the submission creates or finds a Contact, records the `lead`
 * conversion and, when the request carries the visitor id (X-PW-VID header
 * or pw_vid cookie), attaches that visitor's touchpoints to the contact.
 * The slug `platform` is the platform's own marketing site.
 */
@Controller('public/studios')
export class LeadsPublicController {
  constructor(private readonly leads: LeadsCompatService) {}

  @Post(':slug/leads')
  @HttpCode(202)
  @UseGuards(LeadsPublicRateLimitGuard)
  async submit(@Param('slug') slug: string, @ZodBody(PublicLeadFormSchema) body: PublicLeadFormInput, @Req() req: Request) {
    await this.leads.submitPublicForm(slug, body, readVisitorId(req.headers));
    return { received: true };
  }
}
