import { Injectable } from '@nestjs/common';
import { MembershipStatus } from '@platform/database';
import type { BirthdayParams } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTOMATION_BATCH_LIMIT, AutomationCandidate, RuleEvaluator, addDays } from './types';

/**
 * Members whose birthday (month/day) falls on `now + daysBefore`. Fires at
 * most once per calendar year per member. Candidates are filtered in memory
 * after a bounded fetch; see docs/AUTOMATIONS.md for the scaling note (a
 * raw EXTRACT(MONTH/DAY) query would avoid this once tenants grow large).
 */
@Injectable()
export class BirthdayEvaluator implements RuleEvaluator {
  readonly type = 'BIRTHDAY' as const;

  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(
    studioId: string,
    params: BirthdayParams,
    now: Date,
    limit = AUTOMATION_BATCH_LIMIT,
  ): Promise<AutomationCandidate[]> {
    const target = addDays(now, params.daysBefore);
    const targetMonth = target.getUTCMonth();
    const targetDay = target.getUTCDate();

    const members = await this.prisma.memberProfile.findMany({
      // Partner-guest memberships are excluded: marketing automations only
      // target people who have onboarded into the app themselves.
      where: { studioId, birthDate: { not: null }, membership: { status: MembershipStatus.ACTIVE, isPartnerGuest: false } },
      select: {
        id: true,
        birthDate: true,
        membership: { select: { userId: true, user: { select: { firstName: true } } } },
      },
      take: limit,
    });

    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } });
    const year = now.getUTCFullYear();

    return members
      .filter((m) => m.birthDate && m.birthDate.getUTCMonth() === targetMonth && m.birthDate.getUTCDate() === targetDay)
      .map((m) => ({
        userId: m.membership.userId,
        targetRef: `${m.id}:${year}`,
        scheduledFor: now,
        templateParams: { firstName: m.membership.user.firstName, studioName: studio.name },
      }));
  }
}
