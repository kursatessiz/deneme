import { Injectable } from '@nestjs/common';
import { MembershipStatus, PackageStatus } from '@platform/database';
import type { PackageExpiringParams } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTOMATION_BATCH_LIMIT, AutomationCandidate, RuleEvaluator, addDays, formatDateTr } from './types';

/** Active packages ending within `daysBefore` days, or with at most `remainingUnitsAtMost` units left. */
@Injectable()
export class PackageExpiringEvaluator implements RuleEvaluator {
  readonly type = 'PACKAGE_EXPIRING' as const;

  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(
    studioId: string,
    params: PackageExpiringParams,
    now: Date,
    limit = AUTOMATION_BATCH_LIMIT,
  ): Promise<AutomationCandidate[]> {
    const or: Array<Record<string, unknown>> = [];
    if (params.daysBefore !== undefined) {
      or.push({ endDate: { gte: now, lte: addDays(now, params.daysBefore) } });
    }
    if (params.remainingUnitsAtMost !== undefined) {
      or.push({ remainingUnits: { not: null, lte: params.remainingUnitsAtMost } });
    }
    if (or.length === 0) return [];

    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { timezone: true } });

    const packages = await this.prisma.memberPackage.findMany({
      // Partner-guest memberships are excluded: marketing automations only
      // target people who have onboarded into the app themselves.
      where: {
        studioId,
        status: PackageStatus.ACTIVE,
        OR: or,
        member: { membership: { status: MembershipStatus.ACTIVE, isPartnerGuest: false } },
      },
      select: {
        id: true,
        endDate: true,
        remainingUnits: true,
        packageDefinition: { select: { name: true } },
        member: { select: { membership: { select: { userId: true, user: { select: { firstName: true } } } } } },
      },
      take: limit,
    });

    return packages.map((p) => ({
      userId: p.member.membership.userId,
      targetRef: p.id,
      scheduledFor: now,
      templateParams: {
        firstName: p.member.membership.user.firstName,
        packageName: p.packageDefinition.name,
        remainingUnits: p.remainingUnits === null ? 'sınırsız' : String(p.remainingUnits),
        expiryDate: formatDateTr(p.endDate, studio.timezone),
      },
    }));
  }
}
