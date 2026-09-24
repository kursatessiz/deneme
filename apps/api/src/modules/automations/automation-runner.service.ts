import { Injectable, Logger } from '@nestjs/common';
import { Prisma, AutomationRunStatus } from '@platform/database';
import type { AutomationRule } from '@platform/database';
import { AutomationRuleParamsSchema, isWithinQuietHours, type NotificationCategory } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AUTOMATION_BATCH_LIMIT, AutomationCandidate, RuleEvaluator } from './evaluators/types';
import { WinBackEvaluator } from './evaluators/win-back.evaluator';
import { PackageExpiringEvaluator } from './evaluators/package-expiring.evaluator';
import { BirthdayEvaluator } from './evaluators/birthday.evaluator';
import { FirstClassFollowUpEvaluator } from './evaluators/first-class-follow-up.evaluator';
import { BookingReminderEvaluator } from './evaluators/booking-reminder.evaluator';
import { NoShowFollowUpEvaluator } from './evaluators/no-show-follow-up.evaluator';

export interface RunOutcome {
  ruleId: string;
  sent: number;
  skipped: number;
  failed: number;
  deferredForQuietHours: boolean;
}

/** Failure reasons that reflect a policy or preference decision, not a delivery error. */
const SKIP_REASON_RE = /onay|kapat|bulunamadı|şablon|yapılandır|yetersiz/i;

/** Prisma's unique-constraint violation code (P2002). */
function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const CATEGORY_BY_TYPE: Record<AutomationRule['type'], NotificationCategory> = {
  BOOKING_REMINDER: 'BOOKING_REMINDER',
  PACKAGE_EXPIRING: 'PACKAGE',
  WIN_BACK: 'MARKETING',
  BIRTHDAY: 'MARKETING',
  FIRST_CLASS_FOLLOW_UP: 'BOOKING_REMINDER',
  NO_SHOW_FOLLOW_UP: 'BOOKING_REMINDER',
};

@Injectable()
export class AutomationRunnerService {
  private readonly logger = new Logger(AutomationRunnerService.name);
  private readonly evaluators: Record<AutomationRule['type'], RuleEvaluator>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    winBack: WinBackEvaluator,
    packageExpiring: PackageExpiringEvaluator,
    birthday: BirthdayEvaluator,
    firstClassFollowUp: FirstClassFollowUpEvaluator,
    bookingReminder: BookingReminderEvaluator,
    noShowFollowUp: NoShowFollowUpEvaluator,
  ) {
    this.evaluators = {
      WIN_BACK: winBack,
      PACKAGE_EXPIRING: packageExpiring,
      BIRTHDAY: birthday,
      FIRST_CLASS_FOLLOW_UP: firstClassFollowUp,
      BOOKING_REMINDER: bookingReminder,
      NO_SHOW_FOLLOW_UP: noShowFollowUp,
    };
  }

  evaluatorFor(type: AutomationRule['type']): RuleEvaluator {
    return this.evaluators[type];
  }

  /** Dry run: candidates only, no AutomationRun rows and no sends. */
  async previewAudience(rule: Pick<AutomationRule, 'studioId' | 'type' | 'params'>, now = new Date()): Promise<number> {
    const params = AutomationRuleParamsSchema.parse(rule.params);
    const evaluator = this.evaluatorFor(rule.type);
    const candidates = await evaluator.findCandidates(rule.studioId, params, now, 500);
    return candidates.length;
  }

  /** Every active rule across every tenant, bounded per cycle. */
  async runDueRules(now = new Date()): Promise<RunOutcome[]> {
    const rules = await this.prisma.automationRule.findMany({ where: { isActive: true }, take: 500 });
    const outcomes: RunOutcome[] = [];
    for (const rule of rules) {
      try {
        outcomes.push(await this.runRule(rule, now));
      } catch (err) {
        this.logger.error(`Automation rule ${rule.id} (${rule.type}) failed: ${(err as Error).message}`);
        outcomes.push({ ruleId: rule.id, sent: 0, skipped: 0, failed: 0, deferredForQuietHours: false });
      }
    }
    return outcomes;
  }

  async runRule(rule: AutomationRule, now = new Date()): Promise<RunOutcome> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: rule.studioId }, select: { timezone: true } });

    if (isWithinQuietHours(now, studio.timezone)) {
      return { ruleId: rule.id, sent: 0, skipped: 0, failed: 0, deferredForQuietHours: true };
    }

    const params = AutomationRuleParamsSchema.parse(rule.params);
    const evaluator = this.evaluatorFor(rule.type);
    const candidates = await evaluator.findCandidates(rule.studioId, params, now, AUTOMATION_BATCH_LIMIT);

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const outcome = await this.processCandidate(rule, candidate, now);
      if (outcome === 'SENT') sent += 1;
      else if (outcome === 'SKIPPED') skipped += 1;
      else if (outcome === 'FAILED') failed += 1;
      // outcome === 'ALREADY_HANDLED' contributes to none of the counters.
    }
    return { ruleId: rule.id, sent, skipped, failed, deferredForQuietHours: false };
  }

  private async processCandidate(
    rule: AutomationRule,
    candidate: AutomationCandidate,
    now: Date,
  ): Promise<AutomationRunStatus | 'ALREADY_HANDLED'> {
    // Insert first: the unique (ruleId, userId, targetRef) index is the
    // at-most-once delivery guard. A conflict means another cycle (or a
    // concurrent run) already claimed this target.
    try {
      await this.prisma.automationRun.create({
        data: {
          ruleId: rule.id,
          studioId: rule.studioId,
          userId: candidate.userId,
          targetRef: candidate.targetRef,
          scheduledFor: candidate.scheduledFor,
          status: AutomationRunStatus.SKIPPED,
          reason: 'processing',
        },
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) return 'ALREADY_HANDLED';
      throw err;
    }

    const result = await this.notifications.send({
      studioId: rule.studioId,
      userId: candidate.userId,
      category: CATEGORY_BY_TYPE[rule.type],
      template: rule.templateKey,
      params: candidate.templateParams,
    });

    const status = result.success ? AutomationRunStatus.SENT : SKIP_REASON_RE.test(result.reason ?? '') ? AutomationRunStatus.SKIPPED : AutomationRunStatus.FAILED;

    await this.prisma.automationRun.update({
      where: { ruleId_userId_targetRef: { ruleId: rule.id, userId: candidate.userId, targetRef: candidate.targetRef } },
      data: { status, sentAt: result.success ? now : null, reason: result.success ? null : (result.reason ?? 'Bilinmeyen hata') },
    });

    return status;
  }
}
