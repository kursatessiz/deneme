import { Injectable } from '@nestjs/common';
import { MembershipStatus, PackageStatus, BookingStatus } from '@platform/database';
import type { WinBackParams } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTOMATION_BATCH_LIMIT, AutomationCandidate, RuleEvaluator, addDays, isoWeekKey } from './types';

/**
 * Members with no ATTENDED booking in the last `noAttendanceDays` days (or
 * none ever) and, when required, no currently active package. Re-fires at
 * most once per ISO week while the condition still holds, so a long-inactive
 * member is not messaged on every 15-minute cycle forever.
 */
@Injectable()
export class WinBackEvaluator implements RuleEvaluator {
  readonly type = 'WIN_BACK' as const;

  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(
    studioId: string,
    params: WinBackParams,
    now: Date,
    limit = AUTOMATION_BATCH_LIMIT,
  ): Promise<AutomationCandidate[]> {
    const cutoff = addDays(now, -params.noAttendanceDays);

    const members = await this.prisma.memberProfile.findMany({
      // Partner-guest memberships are excluded: marketing automations only
      // target people who have onboarded into the app themselves.
      where: { studioId, membership: { status: MembershipStatus.ACTIVE, isPartnerGuest: false } },
      select: {
        id: true,
        membership: { select: { userId: true, user: { select: { firstName: true } } } },
        bookings: {
          where: { status: BookingStatus.ATTENDED },
          orderBy: { schedule: { startTime: 'desc' } },
          take: 1,
          select: { schedule: { select: { startTime: true } } },
        },
        packages: params.requireNoActivePackage
          ? { where: { status: PackageStatus.ACTIVE }, select: { id: true }, take: 1 }
          : false,
      },
      take: limit,
    });

    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } });
    const bucket = isoWeekKey(now);

    return members
      .filter((m) => {
        const lastAttended = m.bookings[0]?.schedule.startTime;
        const inactiveLongEnough = !lastAttended || lastAttended < cutoff;
        const noActivePackage = !params.requireNoActivePackage || (m.packages?.length ?? 0) === 0;
        return inactiveLongEnough && noActivePackage;
      })
      .map((m) => ({
        userId: m.membership.userId,
        targetRef: `${m.id}:${bucket}`,
        scheduledFor: now,
        templateParams: { firstName: m.membership.user.firstName, studioName: studio.name },
      }));
  }
}
