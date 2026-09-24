import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ListRatingsQuerySchema, RateBookingSchema } from '@platform/shared';
import type { ListRatingsQueryInput, RateBookingInput } from '@platform/shared';
import { RequirePermission, SelfService, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { TenantContext } from '../auth/tenant-context';
import { RatingsService } from './ratings.service';

@Controller('ratings/studio/:studioId')
@StudioScoped()
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post('bookings/:bookingId')
  @SelfService()
  async rate(@Tenant() tenant: TenantContext, @Param('bookingId', ParseUUIDPipe) bookingId: string, @ZodBody(RateBookingSchema) body: RateBookingInput) {
    return this.ratings.rate(tenant, bookingId, body);
  }

  @Patch('bookings/:bookingId')
  @SelfService()
  async edit(@Tenant() tenant: TenantContext, @Param('bookingId', ParseUUIDPipe) bookingId: string, @ZodBody(RateBookingSchema) body: RateBookingInput) {
    return this.ratings.edit(tenant, bookingId, body);
  }

  @Get('me/given')
  @SelfService()
  async myRatings(@Tenant() tenant: TenantContext) {
    return this.ratings.myRatings(tenant);
  }

  @Get('me/pending')
  @SelfService()
  async myPendingPrompts(@Tenant() tenant: TenantContext) {
    return this.ratings.myPendingPrompts(tenant);
  }

  @Get('me/received')
  @SelfService()
  async myReceived(@Tenant() tenant: TenantContext) {
    return this.ratings.myReceivedSummary(tenant);
  }

  @Get()
  @RequirePermission('reports.view')
  async list(@Tenant() tenant: TenantContext, @ZodQuery(ListRatingsQuerySchema) query: ListRatingsQueryInput) {
    return this.ratings.list(tenant, query);
  }
}
