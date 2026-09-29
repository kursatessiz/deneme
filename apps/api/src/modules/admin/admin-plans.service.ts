import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Plan, PlanPrice } from '@platform/database';
import { PLATFORM_BILLING_CURRENCIES, isPlatformBillingCurrency } from '@platform/shared';
import type { AdminPlanDTO, PlanLimits, PlanPriceInput, UpsertPlanInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

type PricedPlan = Plan & { prices: PlanPrice[] };

@Injectable()
export class AdminPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AdminPlanDTO[]> {
    const plans = await this.prisma.plan.findMany({ orderBy: [{ createdAt: 'asc' }, { key: 'asc' }], include: { prices: true } });
    return plans.map(toAdminPlanDto);
  }

  /**
   * Creates or updates a plan (G5c-1b: prices per billing currency in
   * plan_prices). `prices` is the full set when given (a currency left out
   * is removed, so the plan is no longer offered in it); the deprecated
   * single priceMonthly + currency upserts that one price. The deprecated
   * plans.price_monthly/currency columns get a mirror of one price for one
   * release and are never read to choose a price.
   */
  async upsert(actorUserId: string, input: UpsertPlanInput): Promise<AdminPlanDTO> {
    const existing = await this.prisma.plan.findUnique({ where: { key: input.key }, include: { prices: true } });
    const single: PlanPriceInput | null = input.priceMonthly !== undefined && input.currency ? { currency: input.currency, priceMonthly: input.priceMonthly } : null;
    const current: PlanPriceInput[] = (existing?.prices ?? [])
      .filter((p) => isPlatformBillingCurrency(p.currency))
      .map((p) => ({ currency: p.currency as PlanPriceInput['currency'], priceMonthly: p.priceMonthly.toNumber() }));
    const finalPrices = input.prices ?? (single ? [...current.filter((p) => p.currency !== single.currency), single] : current);
    if (finalPrices.length === 0) throw new BadRequestException('En az bir para biriminde fiyat girilmelidir');
    const mirror = PLATFORM_BILLING_CURRENCIES.map((c) => finalPrices.find((p) => p.currency === c)).find((p): p is PlanPriceInput => p !== undefined) ?? finalPrices[0];

    const plan = await this.prisma.$transaction(async (tx) => {
      const common = {
        name: input.name,
        priceMonthly: mirror.priceMonthly,
        currency: mirror.currency,
        limits: input.limits,
        isActive: input.isActive,
        ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
      };
      const saved = await tx.plan.upsert({ where: { key: input.key }, create: { key: input.key, ...common }, update: common });
      const toWrite = input.prices ?? (single ? [single] : []);
      if (input.prices) {
        await tx.planPrice.deleteMany({ where: { planId: saved.id, currency: { notIn: input.prices.map((p) => p.currency) } } });
      }
      for (const price of toWrite) {
        await tx.planPrice.upsert({
          where: { planId_currency: { planId: saved.id, currency: price.currency } },
          create: { planId: saved.id, currency: price.currency, priceMonthly: new Prisma.Decimal(price.priceMonthly) },
          update: { priceMonthly: new Prisma.Decimal(price.priceMonthly) },
        });
      }
      return tx.plan.findUniqueOrThrow({ where: { id: saved.id }, include: { prices: true } });
    });
    const dto = toAdminPlanDto(plan);
    await this.prisma.auditLog.create({
      data: {
        studioId: null,
        userId: actorUserId,
        action: 'plan.upsert',
        entityType: 'Plan',
        entityId: plan.id,
        metadata: { key: input.key, limits: input.limits, prices: dto.prices.map((p) => ({ currency: p.currency, priceMonthly: p.priceMonthly })), trialDays: plan.trialDays },
      },
    });
    return dto;
  }

  async setActive(actorUserId: string, key: string, isActive: boolean) {
    const plan = await this.prisma.plan.findUnique({ where: { key } });
    if (!plan) throw new NotFoundException('Plan bulunamadı');
    if (!isActive) {
      const inUse = await this.prisma.subscription.count({ where: { planId: plan.id, status: { in: ['TRIALING', 'ACTIVE'] } } });
      if (inUse > 0) throw new ConflictException('Bu planı kullanan aktif abonelikler var, önce onları taşıyın');
    }
    await this.prisma.plan.update({ where: { id: plan.id }, data: { isActive } });
    await this.prisma.auditLog.create({
      data: { studioId: null, userId: actorUserId, action: 'plan.set_active', entityType: 'Plan', entityId: plan.id, metadata: { isActive } },
    });
    return toAdminPlanDto(await this.prisma.plan.findUniqueOrThrow({ where: { id: plan.id }, include: { prices: true } }));
  }
}

function toAdminPlanDto(plan: PricedPlan): AdminPlanDTO {
  const order = (c: string) => {
    const i = (PLATFORM_BILLING_CURRENCIES as readonly string[]).indexOf(c);
    return i === -1 ? PLATFORM_BILLING_CURRENCIES.length : i;
  };
  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    prices: plan.prices
      .filter((p) => isPlatformBillingCurrency(p.currency))
      .sort((a, b) => order(a.currency) - order(b.currency))
      .map((p) => ({ currency: p.currency as AdminPlanDTO['prices'][number]['currency'], priceMonthly: p.priceMonthly.toFixed(2) })),
    trialDays: plan.trialDays,
    limits: (plan.limits ?? {}) as PlanLimits,
    isActive: plan.isActive,
    createdAt: plan.createdAt.toISOString(),
  };
}
