import { Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { MeBookingsService } from './me-bookings.service';
import { CalendarFeedController } from './calendar-feed.controller';
import { CalendarFeedRateLimitGuard } from './calendar-feed-rate-limit.guard';

/**
 * Exports CalendarService and MeBookingsService for MeModule (the
 * authenticated /me/bookings, /me/summary and /me/calendar-feed routes)
 * and owns the public /calendar/:token.ics controller.
 */
@Module({
  controllers: [CalendarFeedController],
  providers: [CalendarService, MeBookingsService, CalendarFeedRateLimitGuard],
  exports: [CalendarService, MeBookingsService],
})
export class CalendarModule {}
