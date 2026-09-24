import { Controller, Get, Post, Param, HttpCode, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PublicApiService } from './public-api.service';
import { EmbedRateLimitGuard } from './embed-rate-limit.guard';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { PublicListSchedulesQuerySchema, PublicListSchedulesQuery, PublicCreateBookingSchema, PublicCreateBookingInput } from '@platform/shared';

const CancelBookingBodySchema = z.object({ reason: z.string().max(500).optional() });

/**
 * Unauthenticated (no API key, no JWT), rate-limited endpoints behind the
 * embeddable booking widget at apps/web `/embed/<slug>` (see
 * apps/web/src/app/embed and docs/PUBLIC_API.md "Embed widget"). Separate
 * from the API-key-gated `/v1/public/*` used by third-party integrations,
 * because the widget's client-side JS cannot hold a secret.
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

  @Post('bookings')
  async createBooking(@Param('slug') slug: string, @ZodBody(PublicCreateBookingSchema) body: PublicCreateBookingInput) {
    const studio = await this.publicApi.resolveStudioForEmbed(slug);
    return this.publicApi.createBooking(studio.id, body);
  }

  @Post('bookings/:bookingId/cancel')
  @HttpCode(200)
  async cancelBooking(@Param('slug') slug: string, @Param('bookingId') bookingId: string, @ZodBody(CancelBookingBodySchema) body: { reason?: string }) {
    const studio = await this.publicApi.resolveStudioForEmbed(slug);
    return this.publicApi.cancelBooking(studio.id, bookingId, body.reason);
  }
}
