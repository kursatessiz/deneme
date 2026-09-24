import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isWithinJoinWindow } from '@platform/shared';

/** Upper bound per run so a huge backlog cannot block the request. */
const BATCH_LIMIT = 500;

/**
 * Sends a "join is open" push to members with a confirmed/attended booking
 * on an ONLINE/HYBRID session once the join window has opened. Idempotent
 * via Booking.joinReminderSentAt (same insert-then-send pattern as W15's
 * RatingPromptService); runs on every scheduler heartbeat (JobsService).
 */
@Injectable()
export class JoinReminderService {
  private readonly logger = new Logger(JoinReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sendDueReminders(now: Date): Promise<{ reminded: number }> {
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { in: ['CONFIRMED', 'ATTENDED'] },
        joinReminderSentAt: null,
        schedule: {
          deliveryMode: { in: ['ONLINE', 'HYBRID'] },
          meetingUrl: { not: null },
          endTime: { gte: now },
        },
      },
      include: { member: { include: { membership: true } }, schedule: { include: { serviceType: true } } },
      take: BATCH_LIMIT,
      orderBy: { createdAt: 'asc' },
    });

    let reminded = 0;
    for (const booking of bookings) {
      if (!isWithinJoinWindow(booking.schedule.startTime, booking.schedule.endTime, now)) continue;

      // Idempotency guard: only the first caller to win this conditional
      // update sends the push, safe under concurrent/duplicate runs.
      const claimed = await this.prisma.booking.updateMany({
        where: { id: booking.id, joinReminderSentAt: null },
        data: { joinReminderSentAt: now },
      });
      if (claimed.count === 0) continue;

      try {
        await this.notifications.notifyUser({
          userId: booking.member.membership.userId,
          studioId: booking.studioId,
          category: 'BOOKING_REMINDER',
          message: {
            title: 'Katılım bağlantın hazır',
            body: `${booking.schedule.serviceType.name} seansına katılmak için uygulamayı açabilirsin.`,
            data: { type: 'SESSION_JOIN_READY', scheduleId: booking.scheduleId, bookingId: booking.id },
          },
        });
        reminded += 1;
      } catch (err) {
        this.logger.warn(`Join reminder push failed for booking ${booking.id}: ${(err as Error).message}`);
      }
    }
    return { reminded };
  }
}
