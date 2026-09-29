import { Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus, type AiTask as DbAiTask } from '@platform/database';
import {
  AI_TASKS,
  MARKETING_AI_TASKS,
  aiBudgetMonthOf,
  aiBudgetMonthStart,
  centsToMicroUsd,
  type AiBudgetSource,
  type AiErrorCode,
  type AiTask,
  type AiTenantStatusDTO,
  type AiTenantUsageRow,
  type AiTokenUsage,
  type AiUsageDashboardDTO,
  type AiUsageTotals,
  type MarketingAiStatusDTO,
  type PlanLimits,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AiSettingsService } from './ai-settings.service';
import { AiError } from './ai-errors';

export interface RecordUsageInput {
  studioId: string | null;
  userId: string | null;
  task: AiTask;
  model: string;
  usage: AiTokenUsage;
  costMicroUsd: number;
  success: boolean;
  errorCode: AiErrorCode | null;
  translationJobId?: string | null;
}

export interface ResolvedBudget {
  cents: number;
  source: AiBudgetSource;
  overrideCents: number | null;
}

function emptyTotals(): AiUsageTotals {
  return { calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costMicroUsd: 0 };
}

/** "YYYY-MM" of the last `count` UTC months, oldest first, ending with the month of `now`. */
export function lastMonths(now: Date, count: number): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    months.push(aiBudgetMonthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return months;
}

/**
 * Usage metering and the per-tenant monthly budget. Budget precedence: the
 * super-admin override on the studio, then the plan's aiMonthlyBudgetCents,
 * then the platform default. The check runs before every tenant call; calls
 * already in flight may overshoot by at most their own cost.
 */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
  ) {}

  /** Stores one metered call and returns the id of its AiUsage row. */
  async record(input: RecordUsageInput): Promise<string> {
    const row = await this.prisma.aiUsage.create({
      data: {
        studioId: input.studioId,
        userId: input.userId,
        task: input.task as DbAiTask,
        model: input.model.slice(0, 80),
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        cacheCreationTokens: input.usage.cacheCreationTokens,
        cacheReadTokens: input.usage.cacheReadTokens,
        costMicroUsd: input.costMicroUsd,
        success: input.success,
        errorCode: input.errorCode,
        translationJobId: input.translationJobId ?? null,
      },
      select: { id: true },
    });
    return row.id;
  }

  async resolveBudget(studioId: string): Promise<ResolvedBudget> {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { aiMonthlyBudgetCents: true } });
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    if (studio.aiMonthlyBudgetCents !== null) {
      return { cents: studio.aiMonthlyBudgetCents, source: 'OVERRIDE', overrideCents: studio.aiMonthlyBudgetCents };
    }
    const subscription = await this.prisma.subscription.findFirst({
      where: { studioId, status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE] } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    const planCents = (subscription?.plan.limits as PlanLimits | null)?.aiMonthlyBudgetCents;
    if (typeof planCents === 'number') return { cents: planCents, source: 'PLAN', overrideCents: null };
    return { cents: await this.settings.getDefaultBudgetCents(), source: 'DEFAULT', overrideCents: null };
  }

  async monthCostMicroUsd(studioId: string, now: Date): Promise<number> {
    const agg = await this.prisma.aiUsage.aggregate({
      where: { studioId, createdAt: { gte: aiBudgetMonthStart(now) } },
      _sum: { costMicroUsd: true },
    });
    return agg._sum.costMicroUsd ?? 0;
  }

  /** Throws 429 AI_MONTHLY_LIMIT_REACHED once this UTC month's spend reaches the budget (0 means off). */
  async assertWithinBudget(studioId: string, now: Date): Promise<void> {
    const budget = await this.resolveBudget(studioId);
    const used = await this.monthCostMicroUsd(studioId, now);
    if (used >= centsToMicroUsd(budget.cents)) throw new AiError('AI_MONTHLY_LIMIT_REACHED');
  }

  /** Spend of this UTC month on the marketing tasks (MARKETING_DRAFT, MARKETING_ANALYSIS, MARKETING_RESEARCH). */
  async marketingMonthCostMicroUsd(studioId: string, now: Date): Promise<number> {
    const agg = await this.prisma.aiUsage.aggregate({
      where: { studioId, task: { in: [...MARKETING_AI_TASKS] as DbAiTask[] }, createdAt: { gte: aiBudgetMonthStart(now) } },
      _sum: { costMicroUsd: true },
    });
    return agg._sum.costMicroUsd ?? 0;
  }

  /** Throws 402 MARKETING_AI_BUDGET_EXCEEDED once this month's marketing spend reaches the marketing budget (0 means off). */
  async assertWithinMarketingBudget(studioId: string, now: Date): Promise<void> {
    const cents = await this.settings.getMarketingBudgetCents();
    const used = await this.marketingMonthCostMicroUsd(studioId, now);
    if (cents <= 0 || used >= centsToMicroUsd(cents)) throw new AiError('MARKETING_AI_BUDGET_EXCEEDED');
  }

  /**
   * Throws 402 MARKETING_AI_DAILY_CAP_EXCEEDED once today's (UTC) marketing spend reaches
   * `marketing_settings.ai_daily_cap_cents` of the studio (M3d); no setting or no cap means no daily limit,
   * a cap of 0 blocks the day like a 0 monthly budget does.
   */
  async assertWithinMarketingDailyCap(studioId: string, now: Date): Promise<void> {
    const settings = await this.prisma.marketingSettings.findUnique({ where: { studioId }, select: { aiDailyCapCents: true } });
    const cap = settings?.aiDailyCapCents ?? null;
    if (cap === null) return;
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const agg = await this.prisma.aiUsage.aggregate({
      where: { studioId, task: { in: [...MARKETING_AI_TASKS] as DbAiTask[] }, createdAt: { gte: dayStart } },
      _sum: { costMicroUsd: true },
    });
    if ((agg._sum.costMicroUsd ?? 0) >= centsToMicroUsd(cap)) throw new AiError('MARKETING_AI_DAILY_CAP_EXCEEDED');
  }

  async marketingStatus(studioId: string, configured: boolean, now: Date): Promise<MarketingAiStatusDTO> {
    const cents = await this.settings.getMarketingBudgetCents();
    const used = await this.marketingMonthCostMicroUsd(studioId, now);
    return { configured, budgetCents: cents, usedMicroUsd: used, limitReached: cents <= 0 || used >= centsToMicroUsd(cents) };
  }

  async tenantStatus(studioId: string, configured: boolean, now: Date): Promise<AiTenantStatusDTO> {
    const budget = await this.resolveBudget(studioId);
    const used = await this.monthCostMicroUsd(studioId, now);
    return { configured, budgetCents: budget.cents, usedMicroUsd: used, limitReached: used >= centsToMicroUsd(budget.cents) };
  }

  async setTenantLimit(actorUserId: string, studioId: string, monthlyBudgetCents: number | null): Promise<ResolvedBudget> {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { id: true, aiMonthlyBudgetCents: true } });
    if (!studio) throw new NotFoundException('İşletme bulunamadı');
    await this.prisma.$transaction([
      this.prisma.studio.update({ where: { id: studioId }, data: { aiMonthlyBudgetCents: monthlyBudgetCents } }),
      this.prisma.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'ai.tenant_limit.update',
          entityType: 'Studio',
          entityId: studioId,
          metadata: { before: studio.aiMonthlyBudgetCents, after: monthlyBudgetCents },
        },
      }),
    ]);
    return this.resolveBudget(studioId);
  }

  async dashboard(monthCount: number, now: Date): Promise<AiUsageDashboardDTO> {
    const months = lastMonths(now, monthCount);
    const from = new Date(`${months[0]}-01T00:00:00.000Z`);
    const currentMonthStart = aiBudgetMonthStart(now);
    const sums = { inputTokens: true, outputTokens: true, cacheCreationTokens: true, cacheReadTokens: true, costMicroUsd: true } as const;

    // Aggregated in the database: usage rows grow with every call.
    const [taskGroups, tenantGroups, currentMonthGroups, monthGroups] = await Promise.all([
      this.prisma.aiUsage.groupBy({ by: ['task', 'success'], where: { createdAt: { gte: from } }, _count: { _all: true }, _sum: sums }),
      this.prisma.aiUsage.groupBy({ by: ['studioId', 'success'], where: { createdAt: { gte: from } }, _count: { _all: true }, _sum: sums }),
      this.prisma.aiUsage.groupBy({ by: ['studioId'], where: { createdAt: { gte: currentMonthStart } }, _sum: { costMicroUsd: true } }),
      this.prisma.$queryRaw<Array<{ month: string; success: boolean; calls: bigint; input: bigint | null; output: bigint | null; cache_creation: bigint | null; cache_read: bigint | null; cost: bigint | null }>>`
        SELECT to_char(date_trunc('month', "created_at"), 'YYYY-MM') AS month, "success" AS success, count(*) AS calls,
               sum("input_tokens") AS input, sum("output_tokens") AS output, sum("cache_creation_tokens") AS cache_creation,
               sum("cache_read_tokens") AS cache_read, sum("cost_micro_usd") AS cost
        FROM "ai_usage" WHERE "created_at" >= ${from} GROUP BY 1, 2`,
    ]);

    type Group = { success: boolean; _count: { _all: number }; _sum: { inputTokens: number | null; outputTokens: number | null; cacheCreationTokens: number | null; cacheReadTokens: number | null; costMicroUsd: number | null } };
    const addGroup = (totals: AiUsageTotals, g: Group): void => {
      totals.calls += g._count._all;
      if (!g.success) totals.failedCalls += g._count._all;
      totals.inputTokens += g._sum.inputTokens ?? 0;
      totals.outputTokens += g._sum.outputTokens ?? 0;
      totals.cacheCreationTokens += g._sum.cacheCreationTokens ?? 0;
      totals.cacheReadTokens += g._sum.cacheReadTokens ?? 0;
      totals.costMicroUsd += g._sum.costMicroUsd ?? 0;
    };

    const byMonth = new Map(months.map((m) => [m, emptyTotals()]));
    for (const g of monthGroups) {
      const totals = byMonth.get(g.month);
      if (!totals) continue;
      const calls = Number(g.calls);
      totals.calls += calls;
      if (!g.success) totals.failedCalls += calls;
      totals.inputTokens += Number(g.input ?? 0);
      totals.outputTokens += Number(g.output ?? 0);
      totals.cacheCreationTokens += Number(g.cache_creation ?? 0);
      totals.cacheReadTokens += Number(g.cache_read ?? 0);
      totals.costMicroUsd += Number(g.cost ?? 0);
    }

    const byTask = new Map<AiTask, AiUsageTotals>(AI_TASKS.map((t) => [t, emptyTotals()]));
    for (const g of taskGroups) {
      const totals = byTask.get(g.task as AiTask);
      if (totals) addGroup(totals, g);
    }

    const tenantTotals = new Map<string | null, AiUsageTotals>();
    for (const g of tenantGroups) {
      const totals = tenantTotals.get(g.studioId) ?? emptyTotals();
      addGroup(totals, g);
      tenantTotals.set(g.studioId, totals);
    }
    const currentMonth = new Map(currentMonthGroups.map((g) => [g.studioId, g._sum.costMicroUsd ?? 0]));

    const studioIds = [...tenantTotals.keys()].filter((id): id is string => id !== null);
    const studios = await this.prisma.studio.findMany({ where: { id: { in: studioIds } }, select: { id: true, name: true } });
    const names = new Map(studios.map((st) => [st.id, st.name]));
    const tenantRows: AiTenantUsageRow[] = [];
    for (const [studioId, totals] of tenantTotals) {
      const budget = studioId && names.has(studioId) ? await this.resolveBudget(studioId) : null;
      tenantRows.push({
        ...totals,
        studioId,
        studioName: studioId ? (names.get(studioId) ?? null) : null,
        currentMonthCostMicroUsd: currentMonth.get(studioId) ?? 0,
        budgetCents: budget?.cents ?? null,
        budgetSource: budget?.source ?? null,
        overrideCents: budget?.overrideCents ?? null,
      });
    }
    tenantRows.sort((a, b) => b.costMicroUsd - a.costMicroUsd);

    return {
      months,
      byMonth: months.map((month) => ({ month, ...(byMonth.get(month) ?? emptyTotals()) })),
      byTask: AI_TASKS.map((task) => ({ task, ...(byTask.get(task) ?? emptyTotals()) })),
      byTenant: tenantRows,
    };
  }
}
