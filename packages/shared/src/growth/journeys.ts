import { z } from 'zod';
import { CONVERSION_EVENT_TYPES } from './conversions';
import { SegmentGroupSchema } from './segments';

/**
 * Journey (multi-step automation) definition, section 3.7. A journey is a
 * small directed graph: one trigger, steps keyed by id, each step naming its
 * successor(s). The engine stores per-contact state and runs each step as an
 * idempotent queue job. The six legacy automation rules become templates.
 */

export const MESSAGE_CHANNELS_V2 = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'] as const;
export type MessageChannelV2 = (typeof MESSAGE_CHANNELS_V2)[number];

export const JOURNEY_EVENT_TRIGGERS = [
  ...CONVERSION_EVENT_TYPES,
  'form_submitted',
  'booking_created',
  'booking_cancelled',
  'no_show',
  'package_expiring',
  'package_expired',
  'birthday',
  'tag_added',
  'churn_risk_high',
  'message_replied',
] as const;
export type JourneyEventTrigger = (typeof JOURNEY_EVENT_TRIGGERS)[number];

const stepId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const JourneyTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), event: z.enum(JOURNEY_EVENT_TRIGGERS), filter: SegmentGroupSchema.optional() }).strict(),
  z.object({ kind: z.literal('segment_entered'), segmentId: z.string().uuid() }).strict(),
]);
export type JourneyTrigger = z.infer<typeof JourneyTriggerSchema>;

export const JourneyStepSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('wait'),
      /** Either a fixed delay or until a local time of day in the contact's timezone. */
      minutes: z.number().int().min(1).max(60 * 24 * 90).optional(),
      untilLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      next: stepId.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('send'),
      channel: z.enum(MESSAGE_CHANNELS_V2),
      /** Falls back along the tenant's channel order when the channel is unavailable. */
      allowFallback: z.boolean().default(true),
      templateId: z.string().uuid(),
      purpose: z.enum(['TRANSACTIONAL', 'COMMERCIAL']),
      next: stepId.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('branch'),
      condition: SegmentGroupSchema,
      ifTrue: stepId.nullable(),
      ifFalse: stepId.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('update_contact'),
      addTags: z.array(z.string().max(40)).max(10).default([]),
      removeTags: z.array(z.string().max(40)).max(10).default([]),
      setFields: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
      next: stepId.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('create_task'),
      titleKey: z.string().max(200),
      assignTo: z.enum(['CONTACT_OWNER', 'ROLE', 'USER']),
      assigneeId: z.string().uuid().optional(),
      dueInMinutes: z.number().int().min(0).max(60 * 24 * 30),
      next: stepId.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('award_points'),
      points: z.number().int().min(1).max(100000),
      reasonKey: z.string().max(200),
      next: stepId.nullable(),
    })
    .strict(),
]);
export type JourneyStep = z.infer<typeof JourneyStepSchema>;

export const JourneyDefinitionSchema = z
  .object({
    trigger: JourneyTriggerSchema,
    entryStepId: stepId,
    steps: z.record(stepId, JourneyStepSchema),
    /** Contact leaves the journey when this becomes true (e.g. purchased). */
    goal: SegmentGroupSchema.optional(),
    /** Whether a contact can enter again after finishing. */
    reentry: z.enum(['NEVER', 'AFTER_EXIT', 'ALWAYS']).default('AFTER_EXIT'),
  })
  .strict();
export type JourneyDefinition = z.infer<typeof JourneyDefinitionSchema>;

export const MAX_JOURNEY_STEPS = 50;

/** Graph checks: entry exists, every successor exists, no cycle, size limit. */
export function validateJourneyGraph(definition: JourneyDefinition): string[] {
  const issues: string[] = [];
  const ids = Object.keys(definition.steps);
  if (ids.length === 0) issues.push('En az bir adım gerekli');
  if (ids.length > MAX_JOURNEY_STEPS) issues.push('Çok fazla adım');
  if (!definition.steps[definition.entryStepId]) issues.push(`Başlangıç adımı yok: ${definition.entryStepId}`);

  const successors = (step: JourneyStep): Array<string | null> =>
    step.type === 'branch' ? [step.ifTrue, step.ifFalse] : [step.next];

  for (const [id, step] of Object.entries(definition.steps)) {
    if (step.type === 'wait' && (step.minutes === undefined) === (step.untilLocalTime === undefined)) {
      issues.push(`${id}: bekleme için ya süre ya da saat verilmeli`);
    }
    for (const next of successors(step)) {
      if (next !== null && !definition.steps[next]) issues.push(`${id} adımı olmayan bir adıma bağlı: ${next}`);
    }
  }
  if (issues.length) return issues;

  // Cycle detection (a journey must always terminate).
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): boolean => {
    const s = state.get(id);
    if (s === 'visiting') return false;
    if (s === 'done') return true;
    state.set(id, 'visiting');
    for (const next of successors(definition.steps[id])) {
      if (next !== null && !visit(next)) return false;
    }
    state.set(id, 'done');
    return true;
  };
  if (!visit(definition.entryStepId)) issues.push('Akışta döngü var');
  const unreachable = ids.filter((id) => !state.has(id));
  if (unreachable.length) issues.push(`Ulaşılamayan adımlar: ${unreachable.join(', ')}`);
  return issues;
}
