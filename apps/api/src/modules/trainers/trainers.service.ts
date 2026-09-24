import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';

@Injectable()
export class TrainersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenant: TenantContext) {
    const trainers = await this.prisma.trainerProfile.findMany({
      where: { studioId: tenant.studioId },
      include: {
        membership: { include: { user: true } },
        commissionRule: true,
        qualifications: true,
      },
    });

    return trainers.map((trainer) => ({
      id: trainer.id,
      membershipId: trainer.membershipId,
      studioId: trainer.studioId,
      firstName: trainer.membership.user.firstName,
      lastName: trainer.membership.user.lastName,
      bio: trainer.bio,
      qualifiedServiceTypeIds: trainer.qualifications.map((q) => q.serviceTypeId),
      commissionRule: trainer.commissionRule
        ? {
            id: trainer.commissionRule.id,
            name: trainer.commissionRule.name,
            type: trainer.commissionRule.type,
            value: Number(trainer.commissionRule.value),
          }
        : null,
    }));
  }

  async calculateCommissionReport(tenant: TenantContext, trainerId: string, month: number, year: number) {
    if (!tenant.permissions.has('commissions.view.all')) {
      const canViewOwn = tenant.permissions.has('commissions.view.own') && trainerId === tenant.trainerProfileId;
      if (!canViewOwn) {
        throw new ForbiddenException('Bu hakedişi görüntüleme yetkiniz yok');
      }
    }

    const trainer = await this.prisma.trainerProfile.findFirst({
      where: { id: trainerId, studioId: tenant.studioId },
      include: { membership: { include: { user: true } }, commissionRule: true },
    });
    if (!trainer) {
      throw new NotFoundException('Eğitmen bulunamadı');
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const schedules = await this.prisma.sessionSchedule.findMany({
      where: {
        studioId: tenant.studioId,
        trainerId,
        startTime: { gte: startDate, lte: endDate },
        isCancelled: false,
        bookings: { some: { status: 'ATTENDED' } },
      },
      include: {
        serviceType: { include: { commissionRule: true } },
        bookings: { where: { status: 'ATTENDED' } },
      },
    });

    const totalSessionsTaught = schedules.length;
    let totalEarned = 0;

    const sessions = schedules.map((s) => {
      const rule = trainer.commissionRule ?? s.serviceType.commissionRule;
      let earned = 0;
      if (rule?.type === 'PER_SESSION_FIXED') {
        earned = Number(rule.value);
        totalEarned += earned;
      }
      return {
        id: s.id,
        title: s.title,
        serviceTypeId: s.serviceTypeId,
        startTime: s.startTime,
        attendedMembersCount: s.bookings.length,
        earned,
      };
    });

    // A monthly salary is a flat amount, not summed per session.
    if (trainer.commissionRule?.type === 'MONTHLY_SALARY') {
      totalEarned = Number(trainer.commissionRule.value);
    }

    return {
      trainer: {
        id: trainer.id,
        fullName: `${trainer.membership.user.firstName} ${trainer.membership.user.lastName}`,
        commissionType: trainer.commissionRule?.type ?? null,
        commissionValue: trainer.commissionRule ? Number(trainer.commissionRule.value) : null,
      },
      period: `${month}/${year}`,
      totalSessionsTaught,
      totalEarned,
      sessions,
    };
  }
}
