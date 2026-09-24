import { Controller, Get, Header, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { CalendarFeedTokenParamSchema } from '@platform/shared';
import { CalendarService } from './calendar.service';
import { CalendarFeedRateLimitGuard } from './calendar-feed-rate-limit.guard';

/**
 * Public ICS subscription endpoint. No JWT: the token in the URL is the
 * credential (see CalendarService). Any malformed or unknown token gets
 * the same 404 so the response never reveals which is the case.
 */
@Controller('calendar')
@UseGuards(CalendarFeedRateLimitGuard)
export class CalendarFeedController {
  constructor(private readonly calendar: CalendarService) {}

  @Get(':token.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async getFeed(@Param('token') token: string): Promise<string> {
    const parsed = CalendarFeedTokenParamSchema.safeParse({ token });
    if (!parsed.success) throw new NotFoundException();

    const userId = await this.calendar.resolveUserId(parsed.data.token);
    if (!userId) throw new NotFoundException();

    return this.calendar.buildIcsForUser(userId);
  }
}
