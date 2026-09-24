import { Injectable } from '@nestjs/common';
import { BookingStatus } from '@platform/database';
import type { FirstClassFollowUpParams } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTOMATION_BATCH_LIMIT, AutomationCandidate, RuleEvaluator, addHours } from './types';

/**
 * `hoursAfter` hours after a member's first-ever ATTENDED booking. Uses
 * Postgres DISTINCT ON (via Prisma's `distinct`) to get one row per member:
 * their earliest check-in.
 */
@Injectable()
export class FirstClassFollowUpEvaluator implements RuleEvaluator {
  readonly type = 'FIRST_CLASS_FOLLOW_UP' as const;

  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(
    studioId: string,
    params: FirstClassFollowUpParams,
    now: Date,
    limit = AUTOMATION_BATCH_LIMIT,
  ): Promise<AutomationCandidate[]> {
    const firstAttended = await this.prisma.booking.findMany({
      where: { studioId, status: BookingStatus.ATTENDED, checkInAt: { not: null } },
      distinct: ['memberId'],
      orderBy: [{ memberId: 'asc' }, { checkInAt: 'asc' }],
      select: {
        id: true,
        checkInAt: true,
        member: { select: { membership: { select: { userId: true, user: { select: { firstName: true } } } } } },
      },
      take: limit,
    });

    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } });

    return firstAttended
      .filter((b) => b.checkInAt && addHours(b.checkInAt, params.hoursAfter) <= now)
      .map((b) => ({
        userId: b.member.membership.userId,
        targetRef: b.id,
        scheduledFor: b.checkInAt as Date,
        templateParams: { firstName: b.member.membership.user.firstName, studioName: studio.name },
      }));
  }
}
