import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Journey } from '@platform/database';
import {
  AutomationRuleParamsSchema,
  LEGACY_RULE_TEMPLATE_KEY,
  isScannedJourneyTrigger,
  isTransactionalRuleType,
  legacyRuleFromJourney,
  legacyRuleToJourney,
  winBackSegmentRules,
} from '@platform/shared';
import type {
  AutomationRuleParams,
  AutomationRuleType,
  AutomationRunHistoryQuery,
  CreateAutomationRuleInput,
  JourneyDefinition,
  MessageChannelV2,
  SegmentGroup,
  UpdateAutomationRuleInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LegacyAutomationMigratorService } from '../growth/journeys/legacy-automation-migrator.service';
import { JourneyScannersService } from '../growth/journeys/journey-scanners.service';
import { SegmentsService } from '../growth/segments/segments.service';
import { apiError } from '../../common/api-error';

/** The W10 rule shape the deprecated endpoints keep returning. */
export interface LegacyRuleView {
  id: string;
  studioId: string;
  type: AutomationRuleType;
  name: string;
  params: AutomationRuleParams;
  templateKey: string;
  channel: MessageChannelV2 | null;
  isTransactional: boolean;
  isActive: boolean;
  /** The journey behind this rule (same as id). */
  journeyId: string;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyRuleStats {
  ruleId: string;
  ruleName: string;
  type: AutomationRuleType;
  sent: number;
  skipped: number;
  failed: number;
}

const STATS_WINDOW_DAYS = 30;

/**
 * @deprecated W10 /automation-rules, reduced to a wrapper over journeys
 * (G2a; same pattern as /leads in G1b). Rules are journeys whose
 * legacyRuleType is set: the six rule types are journey templates, and any
 * stored rule row is converted first (LegacyAutomationMigratorService), so
 * the old and new engine never both send. Ids returned here are journey
 * ids; an old rule id is still accepted and resolved to its journey.
 * Removed in the contract release together with the automation tables.
 */
@Injectable()
export class AutomationRulesCompatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly migrator: LegacyAutomationMigratorService,
    private readonly scanners: JourneyScannersService,
    private readonly segments: SegmentsService,
  ) {}

  async list(studioId: string): Promise<LegacyRuleView[]> {
    await this.migrator.migratePending(new Date(), studioId);
    const journeys = await this.prisma.journey.findMany({
      where: { studioId, legacyRuleType: { not: null }, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(journeys.map((j) => this.toView(j)));
  }

  async get(studioId: string, id: string): Promise<LegacyRuleView> {
    return this.toView(await this.journeyFor(studioId, id));
  }

  async create(studioId: string, input: CreateAutomationRuleInput): Promise<LegacyRuleView> {
    const params = input.params;
    const isTransactional = isTransactionalRuleType(input.type);
    const journey = await this.prisma.$transaction(async (tx) => {
      const winBackSegmentId = params.type === 'WIN_BACK' ? await this.migrator.createWinBackSegment(tx, studioId, params) : undefined;
      const definition = legacyRuleToJourney(
        { type: input.type, params, templateKey: input.templateKey, channel: input.channel ?? null, isTransactional },
        { winBackSegmentId },
      );
      return tx.journey.create({
        data: {
          studioId,
          name: input.name,
          status: input.isActive ? 'ACTIVE' : 'PAUSED',
          activatedAt: input.isActive ? new Date() : null,
          definition: definition as unknown as Prisma.InputJsonValue,
          templateKey: LEGACY_RULE_TEMPLATE_KEY[input.type],
          legacyRuleType: input.type,
        },
      });
    });
    return this.toView(journey);
  }

  async update(studioId: string, id: string, input: UpdateAutomationRuleInput): Promise<LegacyRuleView> {
    const journey = await this.journeyFor(studioId, id);
    const type = journey.legacyRuleType as AutomationRuleType;
    const current = await this.toView(journey);
    const params = input.params ?? current.params;
    if (params.type !== type) throw new NotFoundException(apiError('apiErrors.automations.automationRuleNotFound'));
    let definition = journey.definition as unknown as JourneyDefinition;
    if (params.type === 'WIN_BACK' && definition.trigger.kind === 'segment_entered') {
      await this.prisma.segment.updateMany({
        where: { id: definition.trigger.segmentId, studioId },
        data: { rules: winBackSegmentRules(params) as unknown as Prisma.InputJsonValue, refreshedAt: null },
      });
    }
    definition = legacyRuleToJourney(
      {
        type,
        params,
        templateKey: input.templateKey ?? current.templateKey,
        channel: input.channel === undefined ? current.channel : (input.channel as MessageChannelV2 | null),
        isTransactional: current.isTransactional,
      },
      { winBackSegmentId: definition.trigger.kind === 'segment_entered' ? definition.trigger.segmentId : undefined },
    );
    const active = input.isActive ?? current.isActive;
    const updated = await this.prisma.journey.update({
      where: { id: journey.id },
      data: {
        name: input.name,
        definition: definition as unknown as Prisma.InputJsonValue,
        status: active ? 'ACTIVE' : 'PAUSED',
        activatedAt: journey.activatedAt ?? (active ? new Date() : null),
      },
    });
    return this.toView(updated);
  }

  async toggle(studioId: string, id: string, isActive: boolean): Promise<LegacyRuleView> {
    const journey = await this.journeyFor(studioId, id);
    const updated = await this.prisma.journey.update({
      where: { id: journey.id },
      data: { status: isActive ? 'ACTIVE' : 'PAUSED', activatedAt: journey.activatedAt ?? (isActive ? new Date() : null) },
    });
    return this.toView(updated);
  }

  /** Dry-run audience size: the trigger scan (or the win-back segment size), no enrollment, no send. */
  async previewAudience(studioId: string, id: string): Promise<{ count: number }> {
    const journey = await this.journeyFor(studioId, id);
    const def = journey.definition as unknown as JourneyDefinition;
    const now = new Date();
    if (def.trigger.kind === 'segment_entered') {
      const preview = await this.segments.preview(studioId, (await this.segments.get(studioId, def.trigger.segmentId)).rules, now);
      return { count: preview.count };
    }
    if (!isScannedJourneyTrigger(def.trigger.event)) return { count: 0 };
    const trigger = def.trigger as typeof def.trigger & { event: Parameters<JourneyScannersService['scan']>[1]['event'] };
    const candidates = await this.scanners.scan(studioId, trigger, now, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    return { count: candidates.length };
  }

  async stats(studioId: string): Promise<LegacyRuleStats[]> {
    const journeys = await this.prisma.journey.findMany({ where: { studioId, legacyRuleType: { not: null }, status: { not: 'ARCHIVED' } } });
    if (!journeys.length) return [];
    const since = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const grouped = await this.prisma.journeyStepRun.groupBy({
      by: ['journeyId', 'status'],
      where: { studioId, stepType: 'send', journeyId: { in: journeys.map((j) => j.id) }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const count = (journeyId: string, status: string) => grouped.find((g) => g.journeyId === journeyId && g.status === status)?._count._all ?? 0;
    return journeys.map((j) => ({
      ruleId: j.id,
      ruleName: j.name,
      type: j.legacyRuleType as AutomationRuleType,
      sent: count(j.id, 'DONE'),
      skipped: count(j.id, 'SKIPPED'),
      failed: count(j.id, 'FAILED'),
    }));
  }

  /** Send-step history of the legacy journeys, in the old run shape. */
  async history(studioId: string, query: AutomationRunHistoryQuery) {
    const journeyFilter = query.ruleId ? [(await this.journeyFor(studioId, query.ruleId)).id] : undefined;
    const status = query.status === 'SENT' ? 'DONE' : query.status;
    const runs = await this.prisma.journeyStepRun.findMany({
      where: {
        studioId,
        stepType: 'send',
        journey: { legacyRuleType: { not: null } },
        ...(journeyFilter ? { journeyId: { in: journeyFilter } } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
      include: {
        journey: { select: { name: true, legacyRuleType: true } },
        enrollment: { select: { triggerRef: true, contact: { select: { firstName: true, lastName: true } } } },
      },
    });
    return {
      items: runs.map((r) => ({
        id: r.id,
        ruleId: r.journeyId,
        studioId: r.studioId,
        targetRef: r.enrollment.triggerRef,
        status: r.status === 'DONE' ? 'SENT' : r.status,
        reason: r.reasonCode,
        createdAt: r.createdAt.toISOString(),
        rule: { name: r.journey.name, type: r.journey.legacyRuleType },
        contact: { firstName: r.enrollment.contact.firstName, lastName: r.enrollment.contact.lastName },
      })),
    };
  }

  // ---------------------------------------------------------------------------

  /** A journey id, or a legacy rule id resolved to its journey; always within this studio. */
  private async journeyFor(studioId: string, id: string): Promise<Journey> {
    await this.migrator.migratePending(new Date(), studioId);
    const journey = await this.prisma.journey.findFirst({
      where: { studioId, legacyRuleType: { not: null }, OR: [{ id }, { legacyRuleId: id }] },
    });
    if (!journey) throw new NotFoundException(apiError('apiErrors.automations.automationRuleNotFound'));
    return journey;
  }

  private async toView(journey: Journey): Promise<LegacyRuleView> {
    const type = journey.legacyRuleType as AutomationRuleType;
    const def = journey.definition as unknown as JourneyDefinition;
    let winBackRules: SegmentGroup | null = null;
    if (def.trigger.kind === 'segment_entered') {
      const segment = await this.prisma.segment.findFirst({ where: { id: def.trigger.segmentId, studioId: journey.studioId }, select: { rules: true } });
      winBackRules = (segment?.rules as SegmentGroup | null) ?? null;
    }
    const legacy = legacyRuleFromJourney(type, def, winBackRules);
    return {
      id: journey.id,
      studioId: journey.studioId,
      type,
      name: journey.name,
      params: AutomationRuleParamsSchema.parse(legacy.params),
      templateKey: legacy.templateKey,
      channel: legacy.channel,
      isTransactional: legacy.isTransactional,
      isActive: journey.status === 'ACTIVE',
      journeyId: journey.id,
      createdAt: journey.createdAt.toISOString(),
      updatedAt: journey.updatedAt.toISOString(),
    };
  }
}
