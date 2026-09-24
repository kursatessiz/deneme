import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PublicApiService } from './public-api.service';
import { EmbedRateLimitGuard } from './embed-rate-limit.guard';
import { ZodQuery } from '../../common/zod-body.pipe';
import { PublicListSchedulesQuerySchema, PublicListSchedulesQuery } from '@platform/shared';

/**
 * Unauthenticated (no API key, no JWT), rate-limited, READ-ONLY endpoints
 * behind the embeddable booking widget at apps/web `/embed/<slug>` (see
 * apps/web/src/app/embed and docs/PUBLIC_API.md "Embed widget").
 *
 * There is deliberately no write endpoint here. An earlier version of this
 * controller let anyone who knew a member's phone number book or cancel
 * sessions on their behalf, with nothing but an IP rate limit standing in
 * the way -- rate limiting slows an attacker down, it does not authenticate
 * anyone. Booking always requires the member to be signed in to the member
 * app; a first-time visitor is routed to the existing public lead form
 * instead. See PublicApiService.listSchedules for what this exposes: no
 * attendee, member or booking data, ever.
 */
@Controller('public/studios/:slug/embed')
@UseGuards(EmbedRateLimitGuard)
export class EmbedPublicController {
  constructor(private publicApi: PublicApiService) {}

  @Get('config')
  async config(@Param('slug') slug: string) {
    const studio = await this.publicApi.resolveStudioForEmbed(slug);
    return {
      name: studio.name,
      logoUrl: studio.logoUrl,
      themeFamily: studio.themeFamily,
      themePrimary: studio.themePrimary,
      gradientPresetKey: studio.gradientPresetKey,
    };
  }

  @Get('branches')
  async branches(@Param('slug') slug: string) {
    const studio = await this.publicApi.resolveStudioForEmbed(slug);
    return this.publicApi.listBranches(studio.id);
  }

  @Get('service-types')
  async serviceTypes(@Param('slug') slug: string) {
    const studio = await this.publicApi.resolveStudioForEmbed(slug);
    return this.publicApi.listServiceTypes(studio.id);
  }

  @Get('schedules')
  async schedules(@Param('slug') slug: string, @ZodQuery(PublicListSchedulesQuerySchema) query: PublicListSchedulesQuery) {
    const studio = await this.publicApi.resolveStudioForEmbed(slug);
    return this.publicApi.listSchedules(studio.id, query.branchId, new Date(query.from), new Date(query.to));
  }
}
