import { Controller, Get, Post, Param, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PublicApiService } from './public-api.service';
import { PublicApiScoped } from '../api-keys/require-scope.decorator';
import { ApiKeyTenant } from '../api-keys/api-key-tenant.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import {
  PublicListSchedulesQuerySchema,
  PublicListSchedulesQuery,
  PublicListBookingsQuerySchema,
  PublicListBookingsQuery,
  PublicCreateBookingSchema,
  PublicCreateBookingInput,
} from '@platform/shared';
import type { ApiKeyTenantContext } from '../api-keys/api-key-tenant-context';

const CancelBookingBodySchema = z.object({ reason: z.string().max(500).optional() });

/**
 * Public REST API for third-party integrations, authenticated by API key
 * (Authorization: Bearer pk_live_...), not JWT. See docs/PUBLIC_API.md.
 */
@ApiTags('Public API')
@Controller('v1/public')
export class PublicApiController {
  constructor(private publicApi: PublicApiService) {}

  @Get('branches')
  @PublicApiScoped('schedules.read')
  async listBranches(@ApiKeyTenant() tenant: ApiKeyTenantContext) {
    return this.publicApi.listBranches(tenant.studioId);
  }

  @Get('service-types')
  @PublicApiScoped('schedules.read')
  async listServiceTypes(@ApiKeyTenant() tenant: ApiKeyTenantContext) {
    return this.publicApi.listServiceTypes(tenant.studioId);
  }

  @Get('schedules')
  @PublicApiScoped('schedules.read')
  async listSchedules(@ApiKeyTenant() tenant: ApiKeyTenantContext, @ZodQuery(PublicListSchedulesQuerySchema) query: PublicListSchedulesQuery) {
    return this.publicApi.listSchedules(tenant.studioId, query.branchId, new Date(query.from), new Date(query.to));
  }

  @Get('bookings')
  @PublicApiScoped('bookings.read')
  async listBookings(@ApiKeyTenant() tenant: ApiKeyTenantContext, @ZodQuery(PublicListBookingsQuerySchema) query: PublicListBookingsQuery) {
    return this.publicApi.listBookings(
      tenant.studioId,
      { branchId: query.branchId, scheduleId: query.scheduleId },
      query.page,
      query.pageSize,
      tenant.scopes.has('members.read'),
    );
  }

  @Post('bookings')
  @PublicApiScoped('bookings.write')
  async createBooking(@ApiKeyTenant() tenant: ApiKeyTenantContext, @ZodBody(PublicCreateBookingSchema) body: PublicCreateBookingInput) {
    return this.publicApi.createBooking(tenant.studioId, body);
  }

  @Post('bookings/:bookingId/cancel')
  @HttpCode(200)
  @PublicApiScoped('bookings.write')
  async cancelBooking(
    @ApiKeyTenant() tenant: ApiKeyTenantContext,
    @Param('bookingId') bookingId: string,
    @ZodBody(CancelBookingBodySchema) body: { reason?: string },
  ) {
    return this.publicApi.cancelBooking(tenant.studioId, bookingId, body.reason);
  }
}
