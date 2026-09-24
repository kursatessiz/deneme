import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** How far back to look for attendees who have not been prompted yet. */
const PROMPT_WINDOW_HOURS = 48;
/** Upper bound per run so a huge backlog cannot block the request. */
const BATCH_LIMIT = 500;

@Injectable()
export class RatingPromptService {
  private readonly logger = new Logger(RatingPromptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Sends a "rate your session" push to members who attended a session that
   * ended recently and have not been prompted yet. Idempotent via
   * Booking.ratingPromptSentAt: no BullMQ job is wired up for this API yet
   * (see HANDOVER.md), so this is called by a super-admin trigger
   * (POST /admin/feedback/rating-prompts/run) until a scheduler exists.
   */
  async promptRecentAttendees(now: Date): Promise<{ prompted: number }> {
    const windowStart = new Date(now.getTime() - PROMPT_WINDOW_HOURS * 60 * 60 * 1000);

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'ATTENDED',
        ratingPromptSentAt: null,
        schedule: { endTime: { gte: windowStart, lte: now } },
      },
      include: { member: { include: { membership: true } }, schedule: { include: { serviceType: true } } },
      take: BATCH_LIMIT,
      orderBy: { createdAt: 'asc' },
    });

    let prompted = 0;
    for (const booking of bookings) {
      // Idempotency guard: only the first caller to win this conditional
      // update sends the push, safe under concurrent/duplicate runs.
      const claimed = await this.prisma.booking.updateMany({
        where: { id: booking.id, ratingPromptSentAt: null },
        data: { ratingPromptSentAt: now },
      });
      if (claimed.count === 0) continue;

      try {
        await this.notifications.notifyUser({
          userId: booking.member.membership.userId,
          studioId: booking.studioId,
          category: 'BOOKING_REMINDER',
          message: {
            title: 'Seansını nasıl buldun?',
            body: `${booking.schedule.serviceType.name} seansını puanlamak ister misin?`,
            data: { type: 'RATE_SESSION', bookingId: booking.id },
          },
        });
        prompted += 1;
      } catch (err) {
        this.logger.warn(`Rating prompt push failed for booking ${booking.id}: ${(err as Error).message}`);
      }
    }
    return { prompted };
  }
}
