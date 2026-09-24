import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { UpsertPlanInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.plan.findMany({ orderBy: { priceMonthly: 'asc' } });
  }

  async upsert(actorUserId: string, input: UpsertPlanInput) {
    const plan = await this.prisma.plan.upsert({
      where: { key: input.key },
      create: { key: input.key, name: input.name, priceMonthly: input.priceMonthly, limits: input.limits, isActive: input.isActive },
      update: { name: input.name, priceMonthly: input.priceMonthly, limits: input.limits, isActive: input.isActive },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId: null,
        userId: actorUserId,
        action: 'plan.upsert',
        entityType: 'Plan',
        entityId: plan.id,
        metadata: { key: input.key, limits: input.limits, priceMonthly: input.priceMonthly },
      },
    });
    return plan;
  }

  async setActive(actorUserId: string, key: string, isActive: boolean) {
    const plan = await this.prisma.plan.findUnique({ where: { key } });
    if (!plan) throw new NotFoundException('Plan bulunamadı');
    if (!isActive) {
      const inUse = await this.prisma.subscription.count({ where: { planId: plan.id, status: { in: ['TRIALING', 'ACTIVE'] } } });
      if (inUse > 0) throw new ConflictException('Bu planı kullanan aktif abonelikler var, önce onları taşıyın');
    }
    const updated = await this.prisma.plan.update({ where: { id: plan.id }, data: { isActive } });
    await this.prisma.auditLog.create({
      data: { studioId: null, userId: actorUserId, action: 'plan.set_active', entityType: 'Plan', entityId: plan.id, metadata: { isActive } },
    });
    return updated;
  }
}
