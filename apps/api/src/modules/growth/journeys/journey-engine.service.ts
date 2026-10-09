import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Journey, JourneyEnrollment } from '@platform/database';
import {
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  JOURNEY_BATCH_SIZE,
  JOURNEY_QUIET_HOURS_MAX_DEFER_HOURS,
  JOURNEY_SCAN_LOOKBACK_DAYS,
  JourneyDefinitionSchema,
  createTranslator,
  effectiveChannelOrder,
  isScannedJourneyTrigger,
  nextLocalTime,
  normalizeTag,
  parseNotificationSettings,
  validateCustomFieldValue,
} from '@platform/shared';
import type { EngineChannel, JourneyDefinition, JourneyStep, MessageKey } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from '../../messaging/engine/messaging.service';
import { GrowthEventsService } from '../../crm/hooks/growth-events.service';
import type { GrowthEvent } from '../../crm/hooks/growth-events.service';
import { SegmentEvaluatorService } from '../segments/segment-evaluator.service';
import { SegmentsService } from '../segments/segments.service';
import type { SegmentEntry } from '../segments/segments.service';
import { JourneyScannersService, isoWeekKey } from './journey-scanners.service';
import { GrowthQueueService } from '../growth-queue.service';
import { dedupeTags } from '../../crm/contacts/contacts.service';
import { LoyaltyEarnService } from '../../loyalty/loyalty-earn.service';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Steps one enrollment may advance in a single job (the graph is acyclic and at most 50 steps). */
const MAX_STEPS_PER_RUN = 60;
/** How long a worker holds an enrollment. */
const CLAIM_MS = 5 * MINUTE_MS;
/** Retry delay after an unexpected error inside a step. */
const ERROR_RETRY_MS = 15 * MINUTE_MS;

export interface EnrollTrigger {
  ref: string;
  occurredAt: Date;
  variables?: Record<string, string>;
  /** W10 runner reference: skip when that rule already sent to this target. */
  legacy?: { userId: string; targetRef: string } | null;
}

export type EnrollOutcome = 'ENROLLED' | 'DUPLICATE' | 'FILTERED' | 'GOAL_MET' | 'LEGACY_SENT' | 'CONTACT_MISSING';

export interface JourneyRunOutcome {
  scanned: number;
  enrolled: number;
  advanced: number;
  completed: number;
}

type StepResult =
  | { kind: 'advance'; next: string | null; status: 'DONE' | 'SKIPPED' | 'FAILED'; reasonCode?: string; notificationLogId?: string; detail?: Prisma.InputJsonValue; enteredAt?: Date }
  | { kind: 'hold'; until: Date };

interface EnrollmentContext {
  variables: Record<string, string>;
}

function parseDefinition(journey: Pick<Journey, 'definition'>): JourneyDefinition {
  return JourneyDefinitionSchema.parse(journey.definition);
}

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * The journey engine (section 3.7, docs/KAMPANYA_VE_AKISLAR.md).
 *
 * Enrollment: events (GrowthEventsService), segment entries
 * (SegmentsService) and the heartbeat scan of time-based triggers all end
 * in enroll(), which is idempotent on (journey, contact, trigger reference)
 * and enforces the re-entry policy with the lockKey unique index.
 *
 * Execution: an enrollment is a small state machine (current step, when it
 * was reached, next run time). A worker claims it (lockedUntil), checks the
 * goal, runs steps until one has to wait, and releases it. Every step is
 * recorded once in journey_step_runs; a send uses the messaging engine's
 * idempotency key journey:<enrollment>:<step>, so a retried job never sends
 * twice, and consent, quiet hours and the frequency cap always apply.
 */
@Injectable()
export class JourneyEngineService implements OnModuleInit {
  private readonly logger = new Logger(JourneyEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly evaluator: SegmentEvaluatorService,
    private readonly segments: SegmentsService,
    private readonly scanners: JourneyScannersService,
    private readonly events: GrowthEventsService,
    private readonly queue: GrowthQueueService,
    private readonly loyalty: LoyaltyEarnService,
  ) {}

  onModuleInit(): void {
    this.events.subscribe((event) => this.onEvent(event));
    this.segments.onEntries((entries) => this.onSegmentEntries(entries));
  }

  // ---------------------------------------------------------------------------
  // Triggers
  // ---------------------------------------------------------------------------

  async onEvent(event: GrowthEvent): Promise<void> {
    const journeys = await this.prisma.journey.findMany({ where: { studioId: event.studioId, status: 'ACTIVE' } });
    for (const journey of journeys) {
      const def = this.safeDefinition(journey);
      if (!def || def.trigger.kind !== 'event' || def.trigger.event !== event.event) continue;
      await this.enroll(journey, event.contactId, { ref: event.ref, occurredAt: event.occurredAt, variables: event.variables }, new Date());
    }
  }

  async onSegmentEntries(entries: SegmentEntry[]): Promise<void> {
    const bySegment = new Map<string, SegmentEntry[]>();
    for (const e of entries) bySegment.set(e.segmentId, [...(bySegment.get(e.segmentId) ?? []), e]);
    const studioIds = [...new Set(entries.map((e) => e.studioId))];
    const journeys = await this.prisma.journey.findMany({ where: { studioId: { in: studioIds }, status: 'ACTIVE' } });
    for (const journey of journeys) {
      const def = this.safeDefinition(journey);
      if (!def || def.trigger.kind !== 'segment_entered') continue;
      for (const entry of bySegment.get(def.trigger.segmentId) ?? []) {
        if (entry.studioId !== journey.studioId) continue;
        const legacy = journey.legacyRuleId ? await this.winBackLegacyRef(journey.studioId, entry.contactId, entry.enteredAt) : null;
        await this.enroll(journey, entry.contactId, { ref: `segment:${entry.segmentId}:${entry.enteredAt.toISOString()}`, occurredAt: entry.enteredAt, legacy }, entry.enteredAt);
      }
    }
  }

  /** Heartbeat: time-based triggers of every active journey. */
  async scanAll(now: Date): Promise<{ scanned: number; enrolled: number }> {
    const journeys = await this.prisma.journey.findMany({ where: { status: 'ACTIVE' } });
    let scanned = 0;
    let enrolled = 0;
    for (const journey of journeys) {
      const def = this.safeDefinition(journey);
      if (!def || def.trigger.kind !== 'event' || !isScannedJourneyTrigger(def.trigger.event)) continue;
      const trigger = def.trigger as typeof def.trigger & { event: Parameters<JourneyScannersService['scan']>[1]['event'] };
      const lookback = new Date(now.getTime() - JOURNEY_SCAN_LOOKBACK_DAYS * DAY_MS);
      // A migrated journey keeps the old rule's reach; a new journey starts at activation.
      const floor = journey.legacyRuleId || !journey.activatedAt || journey.activatedAt < lookback ? lookback : journey.activatedAt;
      try {
        const candidates = await this.scanners.scan(journey.studioId, trigger, now, floor, journey.id);
        scanned += candidates.length;
        for (const c of candidates) {
          const outcome = await this.enroll(journey, c.contactId, { ref: c.ref, occurredAt: c.occurredAt, variables: c.variables, legacy: c.legacy }, now);
          if (outcome === 'ENROLLED') enrolled += 1;
        }
      } catch (err) {
        this.logger.warn(`Journey ${journey.id} scan failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { scanned, enrolled };
  }

  async enroll(journey: Journey, contactId: string, trigger: EnrollTrigger, now: Date): Promise<EnrollOutcome> {
    const def = this.safeDefinition(journey);
    if (!def) return 'FILTERED';
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, studioId: journey.studioId, mergedIntoId: null }, select: { id: true } });
    if (!contact) return 'CONTACT_MISSING';

    if (def.trigger.kind === 'event' && def.trigger.filter && !(await this.evaluator.matches(journey.studioId, contactId, def.trigger.filter, now))) {
      return 'FILTERED';
    }
    if (def.goal && (await this.evaluator.matches(journey.studioId, contactId, def.goal, now))) return 'GOAL_MET';
    if (journey.legacyRuleId && trigger.legacy) {
      const run = await this.prisma.automationRun.findUnique({
        where: { ruleId_userId_targetRef: { ruleId: journey.legacyRuleId, userId: trigger.legacy.userId, targetRef: trigger.legacy.targetRef } },
        select: { id: true },
      });
      if (run) return 'LEGACY_SENT';
    }

    const lockKey = def.reentry === 'NEVER' ? 'once' : def.reentry === 'AFTER_EXIT' ? 'active' : null;
    try {
      const enrollment = await this.prisma.journeyEnrollment.create({
        data: {
          studioId: journey.studioId,
          journeyId: journey.id,
          contactId,
          triggerRef: trigger.ref.slice(0, 120),
          lockKey,
          currentStepId: def.entryStepId,
          // A wait at the entry step counts from the event itself (e.g. 24 hours after the first visit).
          stepEnteredAt: trigger.occurredAt,
          nextRunAt: now,
          context: { variables: trigger.variables ?? {} } as Prisma.InputJsonValue,
          enteredAt: now,
        },
      });
      await this.queue.scheduleEnrollment(enrollment.id, now);
      return 'ENROLLED';
    } catch (err) {
      if (isUnique(err)) return 'DUPLICATE';
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /** Heartbeat (and queue safety net): every due enrollment of an active journey. */
  async processDue(now: Date): Promise<{ advanced: number; completed: number }> {
    const due = await this.prisma.journeyEnrollment.findMany({
      where: {
        status: 'ACTIVE',
        nextRunAt: { lte: now },
        journey: { status: 'ACTIVE' },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      orderBy: { nextRunAt: 'asc' },
      take: JOURNEY_BATCH_SIZE,
      select: { id: true },
    });
    let advanced = 0;
    let completed = 0;
    for (const { id } of due) {
      const result = await this.processEnrollment(id, now);
      advanced += result.steps;
      if (result.finished) completed += 1;
    }
    return { advanced, completed };
  }

  /** One queue job: claim, run steps until a wait or the end, release. */
  async processEnrollment(enrollmentId: string, now: Date): Promise<{ steps: number; finished: boolean }> {
    const claimed = await this.prisma.journeyEnrollment.updateMany({
      where: { id: enrollmentId, status: 'ACTIVE', OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claimed.count === 0) return { steps: 0, finished: false };

    let steps = 0;
    try {
      let enrollment = await this.prisma.journeyEnrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: { journey: true } });
      if (enrollment.journey.status !== 'ACTIVE') return { steps: 0, finished: false };
      const def = this.safeDefinition(enrollment.journey);
      if (!def) {
        await this.finish(enrollment, 'FAILED', 'INVALID_DEFINITION', now);
        return { steps, finished: true };
      }
      const studio = await this.prisma.studio.findUniqueOrThrow({
        where: { id: enrollment.studioId },
        select: { timezone: true, defaultLocale: true, notificationSettings: true },
      });

      while (steps < MAX_STEPS_PER_RUN) {
        if (def.goal && (await this.evaluator.matches(enrollment.studioId, enrollment.contactId, def.goal, now))) {
          await this.finish(enrollment, 'EXITED_GOAL', 'GOAL', now);
          return { steps, finished: true };
        }
        const stepId = enrollment.currentStepId;
        const step = stepId ? def.steps[stepId] : undefined;
        if (!stepId || !step) {
          await this.finish(enrollment, 'COMPLETED', stepId ? 'STEP_REMOVED' : null, now);
          return { steps, finished: true };
        }

        let result: StepResult;
        try {
          result = await this.runStep(enrollment, stepId, step, studio, now);
        } catch (err) {
          this.logger.warn(`Journey step ${stepId} of enrollment ${enrollment.id} failed: ${err instanceof Error ? err.message : String(err)}`);
          if (now.getTime() - enrollment.stepEnteredAt.getTime() > JOURNEY_QUIET_HOURS_MAX_DEFER_HOURS * HOUR_MS) {
            await this.recordStep(enrollment, stepId, step.type, { status: 'FAILED', reasonCode: 'ERROR' });
            await this.finish(enrollment, 'FAILED', 'STEP_ERROR', now);
            return { steps, finished: true };
          }
          result = { kind: 'hold', until: new Date(now.getTime() + ERROR_RETRY_MS) };
        }

        if (result.kind === 'hold') {
          await this.prisma.journeyEnrollment.update({ where: { id: enrollment.id }, data: { nextRunAt: result.until } });
          await this.queue.scheduleEnrollment(enrollment.id, result.until);
          return { steps, finished: false };
        }

        await this.recordStep(enrollment, stepId, step.type, result);
        steps += 1;
        enrollment = await this.prisma.journeyEnrollment.update({
          where: { id: enrollment.id },
          data: { currentStepId: result.next, stepEnteredAt: result.enteredAt ?? now, nextRunAt: now },
          include: { journey: true },
        });
      }
      return { steps, finished: false };
    } finally {
      await this.prisma.journeyEnrollment.updateMany({ where: { id: enrollmentId }, data: { lockedUntil: null } });
    }
  }

  private async runStep(
    enrollment: JourneyEnrollment,
    stepId: string,
    step: JourneyStep,
    studio: { timezone: string; defaultLocale: string; notificationSettings: Prisma.JsonValue },
    now: Date,
  ): Promise<StepResult> {
    switch (step.type) {
      case 'wait': {
        let until: Date;
        if (step.minutes !== undefined) {
          until = new Date(enrollment.stepEnteredAt.getTime() + step.minutes * MINUTE_MS);
        } else {
          const contact = await this.prisma.contact.findUnique({ where: { id: enrollment.contactId }, select: { timezone: true } });
          until = nextLocalTime(enrollment.stepEnteredAt, step.untilLocalTime as string, contact?.timezone ?? studio.timezone);
        }
        if (until.getTime() > now.getTime()) return { kind: 'hold', until };
        return { kind: 'advance', next: step.next, status: 'DONE', enteredAt: until, detail: { until: until.toISOString() } };
      }

      case 'send': {
        const ctx = (enrollment.context ?? {}) as unknown as EnrollmentContext;
        let channels: EngineChannel[] | undefined;
        if (step.channel) {
          const order = effectiveChannelOrder(parseNotificationSettings(studio.notificationSettings)) as EngineChannel[];
          channels = step.allowFallback ? [step.channel, ...order.filter((c) => c !== step.channel)] : [step.channel];
        }
        const result = await this.messaging.send({
          studioId: enrollment.studioId,
          recipient: { contactId: enrollment.contactId },
          ...(channels ? { channels } : {}),
          purpose: step.purpose,
          ...(step.templateKey ? { templateKey: step.templateKey } : { templateId: step.templateId }),
          variables: ctx.variables ?? {},
          idempotencyKey: `journey:${enrollment.id}:${stepId}`,
          journeyRunId: enrollment.id,
          ...(step.category ? { category: step.category } : {}),
        });
        if (result.success) {
          return { kind: 'advance', next: step.next, status: 'DONE', reasonCode: result.duplicate ? 'DUPLICATE' : undefined, notificationLogId: result.notificationLogId };
        }
        if (result.reasonCode === 'QUIET_HOURS') {
          if (now.getTime() - enrollment.stepEnteredAt.getTime() < JOURNEY_QUIET_HOURS_MAX_DEFER_HOURS * HOUR_MS) {
            const contact = await this.prisma.contact.findUnique({ where: { id: enrollment.contactId }, select: { timezone: true } });
            return { kind: 'hold', until: nextLocalTime(now, '08:00', contact?.timezone ?? studio.timezone) };
          }
        }
        const failed = result.reasonCode === 'PROVIDER_ERROR';
        return { kind: 'advance', next: step.next, status: failed ? 'FAILED' : 'SKIPPED', reasonCode: result.reasonCode ?? 'UNKNOWN', notificationLogId: result.notificationLogId };
      }

      case 'branch': {
        const matched = await this.evaluator.matches(enrollment.studioId, enrollment.contactId, step.condition, now);
        return { kind: 'advance', next: matched ? step.ifTrue : step.ifFalse, status: 'DONE', detail: { matched } };
      }

      case 'update_contact':
        await this.updateContact(enrollment, step);
        return { kind: 'advance', next: step.next, status: 'DONE' };

      case 'create_task': {
        // Claimed first: a retried job never creates the task twice.
        const claimed = await this.claimStep(enrollment, stepId, step.type);
        if (claimed) {
          const assignee = await this.taskAssignee(enrollment, step);
          const locale = studio.defaultLocale;
          const t = createTranslator({ locale, messages: BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
          const title = step.titleKey.startsWith('journeys.task.') ? t(step.titleKey as MessageKey) : step.titleKey;
          await this.prisma.contactTask.create({
            data: {
              studioId: enrollment.studioId,
              contactId: enrollment.contactId,
              title: title.slice(0, 200),
              dueAt: new Date(now.getTime() + step.dueInMinutes * MINUTE_MS),
              assigneeMembershipId: assignee,
            },
          });
        }
        return { kind: 'advance', next: step.next, status: 'DONE' };
      }

      case 'award_points': {
        // Idempotent per enrollment and step (ledger key journey:<enrollment>:<step>),
        // so a retried job never awards twice.
        const outcome = await this.loyalty.awardFromJourney({
          studioId: enrollment.studioId,
          contactId: enrollment.contactId,
          enrollmentId: enrollment.id,
          stepId,
          points: step.points,
          reasonKey: step.reasonKey,
        });
        if (outcome.status === 'SKIPPED') return { kind: 'advance', next: step.next, status: 'SKIPPED', reasonCode: outcome.reasonCode };
        return {
          kind: 'advance',
          next: step.next,
          status: 'DONE',
          reasonCode: outcome.duplicate ? 'DUPLICATE' : undefined,
          detail: { points: outcome.points },
        };
      }
    }
  }

  private async updateContact(enrollment: JourneyEnrollment, step: Extract<JourneyStep, { type: 'update_contact' }>): Promise<void> {
    const contact = await this.prisma.contact.findFirst({ where: { id: enrollment.contactId, studioId: enrollment.studioId } });
    if (!contact) return;
    const remove = new Set(step.removeTags.map((t) => normalizeTag(t)).filter(Boolean));
    const add = step.addTags.map((t) => normalizeTag(t)).filter((t): t is string => Boolean(t));
    const tags = dedupeTags([...contact.tags.filter((t) => !remove.has(t)), ...add]);
    const fields = { ...((contact.customFields ?? {}) as Record<string, unknown>) };
    const keys = Object.keys(step.setFields);
    if (keys.length) {
      const defs = await this.prisma.contactFieldDefinition.findMany({ where: { studioId: enrollment.studioId, key: { in: keys }, isArchived: false } });
      for (const def of defs) {
        const value = step.setFields[def.key];
        if (validateCustomFieldValue(def, value) === null) fields[def.key] = value;
      }
    }
    await this.prisma.contact.update({ where: { id: contact.id }, data: { tags, customFields: fields as Prisma.InputJsonValue } });
  }

  private async taskAssignee(enrollment: JourneyEnrollment, step: Extract<JourneyStep, { type: 'create_task' }>): Promise<string | null> {
    if (step.assignTo === 'CONTACT_OWNER') {
      const contact = await this.prisma.contact.findUnique({ where: { id: enrollment.contactId }, select: { ownerMembershipId: true } });
      return contact?.ownerMembershipId ?? null;
    }
    if (!step.assigneeId) return null;
    if (step.assignTo === 'USER') {
      const m = await this.prisma.membership.findFirst({ where: { id: step.assigneeId, studioId: enrollment.studioId, status: 'ACTIVE' }, select: { id: true } });
      return m?.id ?? null;
    }
    const m = await this.prisma.membership.findFirst({
      where: { roleTemplateId: step.assigneeId, studioId: enrollment.studioId, status: 'ACTIVE' },
      orderBy: { joinedAt: 'asc' },
      select: { id: true },
    });
    return m?.id ?? null;
  }

  private async claimStep(enrollment: JourneyEnrollment, stepId: string, stepType: string): Promise<boolean> {
    try {
      await this.prisma.journeyStepRun.create({
        data: { studioId: enrollment.studioId, journeyId: enrollment.journeyId, enrollmentId: enrollment.id, stepId, stepType, status: 'DONE' },
      });
      return true;
    } catch (err) {
      if (isUnique(err)) return false;
      throw err;
    }
  }

  private async recordStep(
    enrollment: JourneyEnrollment,
    stepId: string,
    stepType: string,
    result: { status: string; reasonCode?: string; notificationLogId?: string; detail?: Prisma.InputJsonValue },
  ): Promise<void> {
    const data = {
      status: result.status,
      reasonCode: result.reasonCode ?? null,
      notificationLogId: result.notificationLogId ?? null,
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
    };
    await this.prisma.journeyStepRun.upsert({
      where: { enrollmentId_stepId: { enrollmentId: enrollment.id, stepId } },
      create: { studioId: enrollment.studioId, journeyId: enrollment.journeyId, enrollmentId: enrollment.id, stepId, stepType, ...data },
      update: data,
    });
  }

  private async finish(enrollment: JourneyEnrollment, status: 'COMPLETED' | 'EXITED_GOAL' | 'EXITED' | 'FAILED' | 'CANCELLED', reason: string | null, now: Date): Promise<void> {
    await this.prisma.journeyEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status,
        exitReason: reason,
        completedAt: now,
        nextRunAt: null,
        // AFTER_EXIT: the next trigger may enroll again; NEVER keeps its "once" key forever.
        ...(enrollment.lockKey === 'active' ? { lockKey: null } : {}),
      },
    });
  }

  /** Cancels every running enrollment of a journey (archive). */
  async cancelAll(journeyId: string, now: Date): Promise<number> {
    const result = await this.prisma.journeyEnrollment.updateMany({
      where: { journeyId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', exitReason: 'JOURNEY_ARCHIVED', completedAt: now, nextRunAt: null, lockKey: null },
    });
    return result.count;
  }

  /** The W10 win-back reference for this contact in the week of `at`. */
  private async winBackLegacyRef(studioId: string, contactId: string, at: Date): Promise<{ userId: string; targetRef: string } | null> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, studioId },
      select: { membership: { select: { userId: true, memberProfile: { select: { id: true } } } } },
    });
    const profile = contact?.membership?.memberProfile;
    if (!contact?.membership || !profile) return null;
    return { userId: contact.membership.userId, targetRef: `${profile.id}:${isoWeekKey(at)}` };
  }

  private safeDefinition(journey: Pick<Journey, 'id' | 'definition'>): JourneyDefinition | null {
    try {
      return parseDefinition(journey);
    } catch {
      this.logger.warn(`Journey ${journey.id} has an invalid definition; skipped`);
      return null;
    }
  }
}
