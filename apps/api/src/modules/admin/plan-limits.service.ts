import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@platform/database';
import type { PlanLimits } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

export type PlanLimitKind = 'maxActiveMembers' | 'maxStaff' | 'maxBranches';

const LIMIT_MESSAGES: Record<PlanLimitKind, string> = {
  maxActiveMembers: 'Planınızın izin verdiği aktif üye sayısına ulaşıldı',
  maxStaff: 'Planınızın izin verdiği personel sayısına ulaşıldı',
  maxBranches: 'Planınızın izin verdiği şube sayısına ulaşıldı',
};

/**
 * Enforces the simple, countable plan limits (CLAUDE.md 4.1: "plan
 * assignment and limits (members, staff, branches, SMS)"). SMS credits are
 * enforced separately by the SMS wallet balance check at send time
 * (NotificationsService), not here. A studio with no active subscription
 * has no enforced limits (pre-billing / trial tenants created by the
 * super-admin before a plan is assigned).
 */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getLimits(studioId: string): Promise<PlanLimits | null> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { studioId, status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE] } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return null;
    return (subscription.plan.limits as PlanLimits) ?? null;
  }

  /** Throws 402 Payment Required when the studio is already at its plan limit for `kind`. */
  async assertWithinLimit(studioId: string, kind: PlanLimitKind): Promise<void> {
    const limits = await this.getLimits(studioId);
    const max = limits?.[kind];
    if (max === undefined || max === null) return;

    const current = await this.countCurrent(studioId, kind);
    if (current >= max) {
      throw new HttpException(
        { statusCode: HttpStatus.PAYMENT_REQUIRED, message: LIMIT_MESSAGES[kind], limit: max, current },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  private async countCurrent(studioId: string, kind: PlanLimitKind): Promise<number> {
    switch (kind) {
      case 'maxActiveMembers':
        return this.prisma.membership.count({
          where: { studioId, status: 'ACTIVE', memberProfile: { isNot: null } },
        });
      case 'maxStaff':
        return this.prisma.membership.count({
          where: {
            studioId,
            status: 'ACTIVE',
            roleTemplate: { isOwner: false },
            memberProfile: null,
          },
        });
      case 'maxBranches':
        return this.prisma.branch.count({ where: { studioId, isActive: true } });
    }
  }
}
