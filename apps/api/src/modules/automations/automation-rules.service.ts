import { Injectable, NotFoundException } from '@nestjs/common';
import { AutomationRunStatus } from '@platform/database';
import type { AutomationRule } from '@platform/database';
import {
  isTransactionalRuleType,
  type AutomationRunHistoryQuery,
  type CreateAutomationRuleInput,
  type UpdateAutomationRuleInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationRunnerService } from './automation-runner.service';

export interface RuleStats {
  ruleId: string;
  ruleName: string;
  type: AutomationRule['type'];
  sent: number;
  skipped: number;
  failed: number;
}

const STATS_WINDOW_DAYS = 30;

@Injectable()
export class AutomationRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AutomationRunnerService,
  ) {}

  async list(studioId: string) {
    return this.prisma.automationRule.findMany({ where: { studioId }, orderBy: { createdAt: 'asc' } });
  }

  async get(studioId: string, id: string): Promise<AutomationRule> {
    const rule = await this.prisma.automationRule.findFirst({ where: { id, studioId } });
    if (!rule) throw new NotFoundException('Otomasyon kuralı bulunamadı');
    return rule;
  }

  async create(studioId: string, input: CreateAutomationRuleInput): Promise<AutomationRule> {
    return this.prisma.automationRule.create({
      data: {
        studioId,
        type: input.type,
        name: input.name,
        params: input.params,
        templateKey: input.templateKey,
        channel: input.channel,
        isActive: input.isActive,
        isTransactional: isTransactionalRuleType(input.type),
      },
    });
  }

  async update(studioId: string, id: string, input: UpdateAutomationRuleInput): Promise<AutomationRule> {
    await this.get(studioId, id);
    return this.prisma.automationRule.update({
      where: { id },
      data: {
        name: input.name,
        params: input.params,
        templateKey: input.templateKey,
        channel: input.channel,
        isActive: input.isActive,
      },
    });
  }

  async toggle(studioId: string, id: string, isActive: boolean): Promise<AutomationRule> {
    await this.get(studioId, id);
    return this.prisma.automationRule.update({ where: { id }, data: { isActive } });
  }

  /** Dry-run audience size, no side effects. */
  async previewAudience(studioId: string, id: string): Promise<{ count: number }> {
    const rule = await this.get(studioId, id);
    const count = await this.runner.previewAudience(rule);
    return { count };
  }

  async history(studioId: string, query: AutomationRunHistoryQuery) {
    if (query.ruleId) await this.get(studioId, query.ruleId);
    const items = await this.prisma.automationRun.findMany({
      where: { studioId, ruleId: query.ruleId, status: query.status },
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
      include: { rule: { select: { name: true, type: true } }, user: { select: { firstName: true, lastName: true, phone: true } } },
    });
    return { items };
  }

  /** Sent/skipped/failed counts per rule over the last 30 days. */
  async stats(studioId: string): Promise<RuleStats[]> {
    const since = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rules = await this.prisma.automationRule.findMany({ where: { studioId }, select: { id: true, name: true, type: true } });
    if (rules.length === 0) return [];

    const grouped = await this.prisma.automationRun.groupBy({
      by: ['ruleId', 'status'],
      where: { studioId, createdAt: { gte: since } },
      _count: { _all: true },
    });

    const countFor = (ruleId: string, status: AutomationRunStatus) =>
      grouped.find((g) => g.ruleId === ruleId && g.status === status)?._count._all ?? 0;

    return rules.map((rule) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      type: rule.type,
      sent: countFor(rule.id, AutomationRunStatus.SENT),
      skipped: countFor(rule.id, AutomationRunStatus.SKIPPED),
      failed: countFor(rule.id, AutomationRunStatus.FAILED),
    }));
  }
}
