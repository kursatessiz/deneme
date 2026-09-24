import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsPublicRateLimitGuard } from './leads-public-rate-limit.guard';
import { ZodBody } from '../../common/zod-body.pipe';
import { PublicLeadFormSchema, PublicLeadFormInput } from '@platform/shared';

/**
 * Unauthenticated web-form endpoint, meant to be embedded on the tenant's
 * own website (see docs/LEADS.md). No JWT, no tenant guard: the studio is
 * resolved from the slug in the path, and the response is a constant 202
 * whatever happens, so the slug cannot be probed for which studios exist.
 */
@Controller('public/studios')
export class LeadsPublicController {
  constructor(private leadsService: LeadsService) {}

  @Post(':slug/leads')
  @HttpCode(202)
  @UseGuards(LeadsPublicRateLimitGuard)
  async submit(@Param('slug') slug: string, @ZodBody(PublicLeadFormSchema) body: PublicLeadFormInput) {
    await this.leadsService.submitPublicForm(slug, body);
    return { received: true };
  }
}
