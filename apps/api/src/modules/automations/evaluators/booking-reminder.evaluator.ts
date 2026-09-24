import { Injectable } from '@nestjs/common';
import { BookingStatus } from '@platform/database';
import type { BookingReminderParams } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTOMATION_BATCH_LIMIT, AutomationCandidate, RuleEvaluator, addHours, formatDateTr } from './types';

/**
 * Confirmed bookings whose session starts within the next `hoursBefore`
 * hours. Matches on every 15-minute cycle until sent; the AutomationRun
 * unique constraint (ruleId, userId, targetRef=bookingId) makes the actual
 * send happen exactly once.
 */
@Injectable()
export class BookingReminderEvaluator implements RuleEvaluator {
  readonly type = 'BOOKING_REMINDER' as const;

  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(
    studioId: string,
    params: BookingReminderParams,
    now: Date,
    limit = AUTOMATION_BATCH_LIMIT,
  ): Promise<AutomationCandidate[]> {
    const horizon = addHours(now, params.hoursBefore);

    const bookings = await this.prisma.booking.findMany({
      where: {
        studioId,
        status: BookingStatus.CONFIRMED,
        schedule: { startTime: { gt: now, lte: horizon }, isCancelled: false },
      },
      select: {
        id: true,
        schedule: { select: { startTime: true, title: true, serviceType: { select: { name: true } } } },
        member: { select: { membership: { select: { userId: true, user: { select: { firstName: true } } } } } },
      },
      take: limit,
    });

    return bookings.map((b) => ({
      userId: b.member.membership.userId,
      targetRef: b.id,
      scheduledFor: b.schedule.startTime,
      templateParams: {
        firstName: b.member.membership.user.firstName,
        serviceName: b.schedule.serviceType?.name ?? b.schedule.title,
        startTime: formatDateTr(b.schedule.startTime),
      },
    }));
  }
}
