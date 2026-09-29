import { z } from 'zod';
import { JourneyDefinitionSchema } from './journeys';
import type { JourneyDefinition, JourneyStep, MessageChannelV2 } from './journeys';
import { AutomationRuleParamsSchema } from '../automations';
import type { AutomationRuleParams, AutomationRuleType } from '../automations';
import type { SegmentCondition, SegmentGroup } from './segments';

/**
 * Journey API contracts and the built-in journey templates (G2a). The six
 * legacy automation rule types (W10) are templates here: the automations
 * module is reduced to a deprecated wrapper and every stored rule is
 * converted into a journey by the same functions (legacyRuleToJourney).
 */

export const JOURNEY_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export const JOURNEY_ENROLLMENT_STATUSES = ['ACTIVE', 'COMPLETED', 'EXITED_GOAL', 'EXITED', 'CANCELLED', 'FAILED'] as const;
export type JourneyEnrollmentStatus = (typeof JOURNEY_ENROLLMENT_STATUSES)[number];

/** How far back a scanned trigger looks for events on each heartbeat. */
export const JOURNEY_SCAN_LOOKBACK_DAYS = 7;
/** Enrollments advanced per heartbeat (and per queue job). */
export const JOURNEY_BATCH_SIZE = 200;
/** A send held back by quiet hours is retried for this long, then skipped. */
export const JOURNEY_QUIET_HOURS_MAX_DEFER_HOURS = 48;

export const CreateJourneySchema = z
  .object({
    name: z.string().trim().min(1, 'Ad giriniz').max(120),
    description: z.string().trim().max(500).optional(),
    definition: JourneyDefinitionSchema,
  })
  .strict();
export type CreateJourneyInput = z.infer<typeof CreateJourneySchema>;

export const UpdateJourneySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    definition: JourneyDefinitionSchema.optional(),
  })
  .strict();
export type UpdateJourneyInput = z.infer<typeof UpdateJourneySchema>;

export const JOURNEY_TEMPLATE_KEYS = [
  'booking_reminder',
  'package_expiring',
  'win_back',
  'birthday',
  'first_class_follow_up',
  'no_show_follow_up',
  'new_lead_follow_up',
] as const;
export type JourneyTemplateKey = (typeof JOURNEY_TEMPLATE_KEYS)[number];

export const CreateJourneyFromTemplateSchema = z
  .object({
    templateKey: z.enum(JOURNEY_TEMPLATE_KEYS),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type CreateJourneyFromTemplateInput = z.infer<typeof CreateJourneyFromTemplateSchema>;

export const JourneyEnrollmentsQuerySchema = z
  .object({
    status: z.enum(JOURNEY_ENROLLMENT_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type JourneyEnrollmentsQuery = z.infer<typeof JourneyEnrollmentsQuerySchema>;

export interface JourneyStatsDTO {
  enrollments: Record<JourneyEnrollmentStatus, number>;
  /** Per step id: DONE / SKIPPED / FAILED counts. */
  steps: Record<string, { done: number; skipped: number; failed: number }>;
}

export interface JourneyDTO {
  id: string;
  name: string;
  description: string | null;
  status: JourneyStatus;
  definition: JourneyDefinition;
  templateKey: string | null;
  legacyRuleType: AutomationRuleType | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyDetailDTO extends JourneyDTO {
  stats: JourneyStatsDTO;
}

export interface JourneyEnrollmentDTO {
  id: string;
  contactId: string;
  fullName: string;
  status: JourneyEnrollmentStatus;
  currentStepId: string | null;
  nextRunAt: string | null;
  enteredAt: string;
  completedAt: string | null;
  exitReason: string | null;
}

export interface JourneyTemplateDTO {
  key: JourneyTemplateKey;
  /** The legacy automation rule type this template replaces, if any. */
  legacyRuleType: AutomationRuleType | null;
  definition: JourneyDefinition;
  /** Message template keys the journey sends (to check they exist before activating). */
  templateKeys: string[];
}

// ---------------------------------------------------------------------------
// Legacy rule -> journey
// ---------------------------------------------------------------------------

export interface LegacyRuleShape {
  type: AutomationRuleType;
  params: unknown;
  templateKey: string;
  channel: MessageChannelV2 | null;
  isTransactional: boolean;
}

export const LEGACY_RULE_TEMPLATE_KEY: Readonly<Record<AutomationRuleType, JourneyTemplateKey>> = {
  BOOKING_REMINDER: 'booking_reminder',
  PACKAGE_EXPIRING: 'package_expiring',
  WIN_BACK: 'win_back',
  BIRTHDAY: 'birthday',
  FIRST_CLASS_FOLLOW_UP: 'first_class_follow_up',
  NO_SHOW_FOLLOW_UP: 'no_show_follow_up',
};

export const DEFAULT_LEGACY_PARAMS: Readonly<Record<AutomationRuleType, AutomationRuleParams>> = {
  BOOKING_REMINDER: { type: 'BOOKING_REMINDER', hoursBefore: 2 },
  PACKAGE_EXPIRING: { type: 'PACKAGE_EXPIRING', daysBefore: 7 },
  WIN_BACK: { type: 'WIN_BACK', noAttendanceDays: 30, requireNoActivePackage: true },
  BIRTHDAY: { type: 'BIRTHDAY', daysBefore: 0 },
  FIRST_CLASS_FOLLOW_UP: { type: 'FIRST_CLASS_FOLLOW_UP', hoursAfter: 24 },
  NO_SHOW_FOLLOW_UP: { type: 'NO_SHOW_FOLLOW_UP', hoursAfter: 2 },
};

/** Win-back audience: members who stopped attending (and, optionally, have no usable package). */
export function winBackSegmentRules(params: Extract<AutomationRuleParams, { type: 'WIN_BACK' }>): SegmentGroup {
  const rules: SegmentGroup['rules'] = [
    { field: 'contact.lifecycleStage', op: 'in', value: ['MEMBER', 'LAPSED'] },
    {
      combinator: 'or',
      rules: [
        { field: 'activity.lastAttendedDaysAgo', op: 'gt', value: params.noAttendanceDays },
        { field: 'activity.lastAttendedDaysAgo', op: 'is_empty' },
      ],
    },
  ];
  if (params.requireNoActivePackage ?? true) rules.push({ field: 'package.hasActive', op: 'is_false' });
  return { combinator: 'and', rules };
}

/**
 * The journey equivalent of a legacy automation rule. Same template key,
 * channel choice, purpose and member notification category, so a migrated
 * tenant's members receive exactly the messages they did before. WIN_BACK
 * needs the id of its audience segment (winBackSegmentRules).
 */
export function legacyRuleToJourney(rule: LegacyRuleShape, opts: { winBackSegmentId?: string } = {}): JourneyDefinition {
  const params = AutomationRuleParamsSchema.parse(rule.params);
  const send = (next: string | null, category: 'BOOKING_REMINDER' | 'PACKAGE' | 'MARKETING') => ({
    type: 'send' as const,
    ...(rule.channel ? { channel: rule.channel } : {}),
    allowFallback: !rule.channel,
    templateKey: rule.templateKey,
    purpose: rule.isTransactional ? ('TRANSACTIONAL' as const) : ('COMMERCIAL' as const),
    category,
    next,
  });
  switch (params.type) {
    case 'BOOKING_REMINDER':
      return {
        trigger: { kind: 'event', event: 'booking_upcoming', leadMinutes: params.hoursBefore * 60 },
        entryStepId: 'send_reminder',
        steps: { send_reminder: send(null, 'BOOKING_REMINDER') },
        reentry: 'ALWAYS',
      };
    case 'PACKAGE_EXPIRING':
      return {
        trigger: {
          kind: 'event',
          event: 'package_expiring',
          ...(params.daysBefore !== undefined ? { daysBefore: params.daysBefore } : {}),
          ...(params.remainingUnitsAtMost !== undefined ? { remainingUnitsAtMost: params.remainingUnitsAtMost } : {}),
        },
        entryStepId: 'send_notice',
        steps: { send_notice: send(null, 'PACKAGE') },
        reentry: 'ALWAYS',
      };
    case 'BIRTHDAY':
      return {
        trigger: { kind: 'event', event: 'birthday', daysBefore: params.daysBefore },
        entryStepId: 'send_greeting',
        steps: { send_greeting: send(null, 'MARKETING') },
        reentry: 'ALWAYS',
      };
    case 'FIRST_CLASS_FOLLOW_UP':
      return {
        trigger: { kind: 'event', event: 'first_session_attended' },
        entryStepId: 'wait_after',
        steps: {
          wait_after: { type: 'wait', minutes: params.hoursAfter * 60, next: 'send_follow_up' },
          send_follow_up: send(null, 'BOOKING_REMINDER'),
        },
        reentry: 'NEVER',
      };
    case 'NO_SHOW_FOLLOW_UP':
      return {
        trigger: { kind: 'event', event: 'no_show' },
        entryStepId: 'wait_after',
        steps: {
          wait_after: { type: 'wait', minutes: params.hoursAfter * 60, next: 'send_follow_up' },
          send_follow_up: send(null, 'BOOKING_REMINDER'),
        },
        reentry: 'ALWAYS',
      };
    case 'WIN_BACK': {
      if (!opts.winBackSegmentId) throw new Error('WIN_BACK journeys need their audience segment id');
      return {
        trigger: { kind: 'segment_entered', segmentId: opts.winBackSegmentId },
        entryStepId: 'send_win_back',
        steps: { send_win_back: send(null, 'MARKETING') },
        goal: { combinator: 'and', rules: [{ field: 'activity.lastAttendedDaysAgo', op: 'lt', value: 1 }] },
        reentry: 'AFTER_EXIT',
      };
    }
  }
}

const LEGACY_TEMPLATE_KEY_BY_TYPE: Readonly<Record<AutomationRuleType, string>> = {
  BOOKING_REMINDER: 'BOOKING_REMINDER',
  PACKAGE_EXPIRING: 'PACKAGE_EXPIRING',
  WIN_BACK: 'WIN_BACK',
  BIRTHDAY: 'BIRTHDAY',
  FIRST_CLASS_FOLLOW_UP: 'FIRST_CLASS_FOLLOW_UP',
  NO_SHOW_FOLLOW_UP: 'NO_SHOW_FOLLOW_UP',
};

const MARKETING_TYPES: ReadonlySet<AutomationRuleType> = new Set(['WIN_BACK', 'BIRTHDAY']);

export function legacyTemplateRule(type: AutomationRuleType): LegacyRuleShape {
  return {
    type,
    params: DEFAULT_LEGACY_PARAMS[type],
    templateKey: LEGACY_TEMPLATE_KEY_BY_TYPE[type],
    channel: null,
    isTransactional: !MARKETING_TYPES.has(type),
  };
}

/**
 * The template gallery. WIN_BACK's segment id is a placeholder that the API
 * replaces with the tenant's own audience segment when the template is used.
 */
export const WIN_BACK_SEGMENT_PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

export function journeyTemplates(): JourneyTemplateDTO[] {
  const legacy = (Object.keys(LEGACY_RULE_TEMPLATE_KEY) as AutomationRuleType[]).map((type) => {
    const rule = legacyTemplateRule(type);
    return {
      key: LEGACY_RULE_TEMPLATE_KEY[type],
      legacyRuleType: type,
      definition: legacyRuleToJourney(rule, { winBackSegmentId: WIN_BACK_SEGMENT_PLACEHOLDER }),
      templateKeys: [rule.templateKey],
    };
  });
  const newLead: JourneyTemplateDTO = {
    key: 'new_lead_follow_up',
    legacyRuleType: null,
    definition: {
      trigger: { kind: 'event', event: 'lead' },
      entryStepId: 'call_task',
      steps: {
        call_task: { type: 'create_task', titleKey: 'journeys.task.callNewLead', assignTo: 'CONTACT_OWNER', dueInMinutes: 60 * 24, next: 'wait_two_days' },
        wait_two_days: { type: 'wait', minutes: 60 * 24 * 2, next: 'still_lead' },
        still_lead: {
          type: 'branch',
          condition: { combinator: 'and', rules: [{ field: 'contact.lifecycleStage', op: 'in', value: ['LEAD'] }] },
          ifTrue: 'second_task',
          ifFalse: null,
        },
        second_task: { type: 'create_task', titleKey: 'journeys.task.followUpLead', assignTo: 'CONTACT_OWNER', dueInMinutes: 60 * 24, next: null },
      },
      goal: { combinator: 'and', rules: [{ field: 'contact.lifecycleStage', op: 'in', value: ['TRIAL', 'MEMBER'] }] },
      reentry: 'NEVER',
    },
    templateKeys: [],
  };
  return [...legacy, newLead];
}

/**
 * The legacy rule view of a journey built by legacyRuleToJourney (the
 * deprecated /automation-rules wrapper). WIN_BACK reads its thresholds from
 * the audience segment's rules.
 */
export function legacyRuleFromJourney(
  type: AutomationRuleType,
  definition: JourneyDefinition,
  winBackRules?: SegmentGroup | null,
): { params: AutomationRuleParams; templateKey: string; channel: MessageChannelV2 | null; isTransactional: boolean } {
  const steps = Object.values(definition.steps);
  const send = steps.find((s): s is Extract<JourneyStep, { type: 'send' }> => s.type === 'send');
  const wait = steps.find((s): s is Extract<JourneyStep, { type: 'wait' }> => s.type === 'wait');
  const ev = definition.trigger.kind === 'event' ? definition.trigger : null;
  const common = {
    templateKey: send?.templateKey ?? '',
    channel: send?.channel ?? null,
    isTransactional: send ? send.purpose === 'TRANSACTIONAL' : true,
  };
  const waitHours = wait?.minutes ? Math.max(1, Math.round(wait.minutes / 60)) : 1;
  let params: AutomationRuleParams;
  switch (type) {
    case 'BOOKING_REMINDER':
      params = { type, hoursBefore: Math.max(1, Math.round((ev?.leadMinutes ?? 120) / 60)) };
      break;
    case 'PACKAGE_EXPIRING':
      params = {
        type,
        ...(ev?.daysBefore !== undefined ? { daysBefore: ev.daysBefore } : {}),
        ...(ev?.remainingUnitsAtMost !== undefined ? { remainingUnitsAtMost: ev.remainingUnitsAtMost } : {}),
      };
      break;
    case 'BIRTHDAY':
      params = { type, daysBefore: ev?.daysBefore ?? 0 };
      break;
    case 'FIRST_CLASS_FOLLOW_UP':
    case 'NO_SHOW_FOLLOW_UP':
      params = { type, hoursAfter: waitHours };
      break;
    case 'WIN_BACK': {
      const flat = flattenConditions(winBackRules ?? null);
      const days = flat.find((c) => c.field === 'activity.lastAttendedDaysAgo' && c.op === 'gt');
      params = {
        type,
        noAttendanceDays: typeof days?.value === 'number' ? days.value : 30,
        requireNoActivePackage: flat.some((c) => c.field === 'package.hasActive' && c.op === 'is_false'),
      };
      break;
    }
  }
  return { params, ...common };
}

function flattenConditions(group: SegmentGroup | null): SegmentCondition[] {
  if (!group) return [];
  return group.rules.flatMap((r) => ('combinator' in r ? flattenConditions(r) : [r]));
}
