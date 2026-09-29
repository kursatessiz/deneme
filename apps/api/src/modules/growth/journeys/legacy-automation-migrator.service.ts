import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { AutomationRule, Journey } from '@platform/database';
import {
  AutomationRuleParamsSchema,
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  LEGACY_RULE_TEMPLATE_KEY,
  createTranslator,
  legacyRuleToJourney,
  winBackSegmentRules,
} from '@platform/shared';
import type { AutomationRuleParams, LegacyRuleShape, MessageChannelV2 } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

const BATCH = 200;

/**
 * Converts W10 automation rules into journeys (G2a, expand-then-contract).
 * One transaction per rule: claim the rule (migrated_journey_id still
 * null), create the journey (and, for WIN_BACK, its audience segment), link
 * and switch the rule off. The journey is ACTIVE exactly when the rule was
 * active; the old runner is gone, so from this point only the journey
 * sends, and it checks automation_runs before enrolling anyone, so no
 * message the old runner already delivered goes out again.
 */
@Injectable()
export class LegacyAutomationMigratorService {
  private readonly logger = new Logger(LegacyAutomationMigratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async migratePending(now = new Date(), studioId?: string): Promise<{ migrated: number; failed: number }> {
    const rules = await this.prisma.automationRule.findMany({
      where: { migratedJourneyId: null, ...(studioId ? { studioId } : {}) },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    let migrated = 0;
    let failed = 0;
    for (const rule of rules) {
      try {
        if (await this.migrateOne(rule, now)) migrated += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(`Automation rule ${rule.id} could not be migrated: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { migrated, failed };
  }

  /** Returns the journey, or null when another worker migrated the rule first. */
  async migrateOne(rule: AutomationRule, now: Date): Promise<Journey | null> {
    const params = AutomationRuleParamsSchema.parse(rule.params);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.automationRule.updateMany({ where: { id: rule.id, migratedJourneyId: null, migratedAt: null }, data: { migratedAt: now } });
      if (claimed.count === 0) return null;

      const winBackSegmentId = params.type === 'WIN_BACK' ? await this.createWinBackSegment(tx, rule.studioId, params) : undefined;
      const shape: LegacyRuleShape = {
        type: rule.type,
        params,
        templateKey: rule.templateKey,
        channel: (rule.channel as MessageChannelV2 | null) ?? null,
        isTransactional: rule.isTransactional,
      };
      const definition = legacyRuleToJourney(shape, { winBackSegmentId });
      const journey = await tx.journey.create({
        data: {
          studioId: rule.studioId,
          name: rule.name,
          status: rule.isActive ? 'ACTIVE' : 'PAUSED',
          definition: definition as unknown as Prisma.InputJsonValue,
          templateKey: LEGACY_RULE_TEMPLATE_KEY[rule.type],
          legacyRuleId: rule.id,
          legacyRuleType: rule.type,
          activatedAt: rule.isActive ? now : null,
        },
      });
      await tx.automationRule.update({ where: { id: rule.id }, data: { migratedJourneyId: journey.id, isActive: false } });
      return journey;
    });
  }

  async createWinBackSegment(db: Prisma.TransactionClient | PrismaService, studioId: string, params: Extract<AutomationRuleParams, { type: 'WIN_BACK' }>): Promise<string> {
    const studio = await db.studio.findUniqueOrThrow({ where: { id: studioId }, select: { defaultLocale: true } });
    const t = createTranslator({ locale: studio.defaultLocale, messages: BUNDLED_MESSAGES[studio.defaultLocale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
    const segment = await db.segment.create({
      data: {
        studioId,
        name: t('journeys.template.win_back.segmentName'),
        kind: 'DYNAMIC',
        rules: winBackSegmentRules(params) as unknown as Prisma.InputJsonValue,
      },
    });
    return segment.id;
  }
}
