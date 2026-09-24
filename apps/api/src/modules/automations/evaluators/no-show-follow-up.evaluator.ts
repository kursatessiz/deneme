import { Injectable } from '@nestjs/common';
import { BookingStatus } from '@platform/database';
import type { NoShowFollowUpParams } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTOMATION_BATCH_LIMIT, AutomationCandidate, RuleEvaluator, addDays, addHours, formatDateTr } from './types';

const LOOKBACK_DAYS = 30;

/** Bookings marked NO_SHOW whose session started at least `hoursAfter` hours ago. */
@Injectable()
export class NoShowFollowUpEvaluator implements RuleEvaluator {
  readonly type = 'NO_SHOW_FOLLOW_UP' as const;

  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(
    studioId: string,
    params: NoShowFollowUpParams,
    now: Date,
    limit = AUTOMATION_BATCH_LIMIT,
  ): Promise<AutomationCandidate[]> {
    const dueBy = addHours(now, -params.hoursAfter);
    const lookback = addDays(now, -LOOKBACK_DAYS);

    const bookings = await this.prisma.booking.findMany({
      where: {
        studioId,
        status: BookingStatus.NO_SHOW,
        schedule: { startTime: { gte: lookback, lte: dueBy } },
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
