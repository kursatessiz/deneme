import { z } from 'zod';
import { CONVERSION_EVENT_TYPES } from './conversions';
import { SegmentGroupSchema } from './segments';
import { NOTIFICATION_CATEGORY_KEYS } from '../notifications';
import type { NotificationCategory } from '../notifications';

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
  /** G2a: a confirmed booking's session starts within `leadMinutes` (scanned). */
  'booking_upcoming',
  /** G2a: a booking was checked in. */
  'session_attended',
  /** G2a: the contact's first ever checked-in booking. */
  'first_session_attended',
] as const;
export type JourneyEventTrigger = (typeof JOURNEY_EVENT_TRIGGERS)[number];

/**
 * Triggers the engine finds by scanning on the scheduler heartbeat (time
 * based conditions), in addition to any live hook. Enrollment is idempotent
 * per (journey, contact, trigger reference), so a scan and a hook for the
 * same booking never enroll twice.
 */
export const SCANNED_JOURNEY_TRIGGERS = [
  'booking_upcoming',
  'package_expiring',
  'package_expired',
  'birthday',
  'no_show',
  'session_attended',
  'first_session_attended',
  'churn_risk_high',
] as const satisfies readonly JourneyEventTrigger[];
export type ScannedJourneyTrigger = (typeof SCANNED_JOURNEY_TRIGGERS)[number];

export function isScannedJourneyTrigger(event: JourneyEventTrigger): event is ScannedJourneyTrigger {
  return (SCANNED_JOURNEY_TRIGGERS as readonly string[]).includes(event);
}

/** Step types the engine cannot run yet; validation rejects them with a clear reason. */
export const UNAVAILABLE_JOURNEY_STEP_TYPES = {
  award_points: 'Puan verme adımı sadakat modülüyle (G3a) etkinleşecek',
} as const;

const stepId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const JourneyTriggerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('event'),
      event: z.enum(JOURNEY_EVENT_TRIGGERS),
      filter: SegmentGroupSchema.optional(),
      /** booking_upcoming: how long before the session starts. */
      leadMinutes: z.number().int().min(15).max(60 * 24 * 14).optional(),
      /** package_expiring: ends within this many days; birthday: this many days before (0 = on the day). */
      daysBefore: z.number().int().min(0).max(90).optional(),
      /** package_expiring: or at most this many units left. */
      remainingUnitsAtMost: z.number().int().min(0).max(1000).optional(),
    })
    .strict(),
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
      /** Omitted: the tenant's channel order (WhatsApp -> SMS by default). */
      channel: z.enum(MESSAGE_CHANNELS_V2).optional(),
      /** Falls back along the tenant's channel order when the channel is unavailable. */
      allowFallback: z.boolean().default(true),
      /** Exactly one of templateId (one tenant/global row) or templateKey (resolved per channel and locale). */
      templateId: z.string().uuid().optional(),
      templateKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).optional(),
      purpose: z.enum(['TRANSACTIONAL', 'COMMERCIAL']),
      /** Legacy notification category: the member's own push/SMS toggles still apply (migrated rules). */
      category: z.enum(NOTIFICATION_CATEGORY_KEYS as [NotificationCategory, ...NotificationCategory[]]).optional(),
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

  const trigger = definition.trigger;
  if (trigger.kind === 'event') {
    if (trigger.event === 'booking_upcoming' && trigger.leadMinutes === undefined) {
      issues.push('Rezervasyon hatırlatması için seanstan ne kadar önce gönderileceği girilmeli');
    }
    if (trigger.leadMinutes !== undefined && trigger.event !== 'booking_upcoming') {
      issues.push('leadMinutes yalnızca booking_upcoming tetikleyicisinde kullanılır');
    }
    if (trigger.event === 'package_expiring' && trigger.daysBefore === undefined && trigger.remainingUnitsAtMost === undefined) {
      issues.push('Paket bitişi için gün sayısı veya kalan hak sınırı girilmeli');
    }
    if (trigger.daysBefore !== undefined && trigger.event !== 'package_expiring' && trigger.event !== 'birthday') {
      issues.push('daysBefore yalnızca package_expiring ve birthday tetikleyicilerinde kullanılır');
    }
    if (trigger.remainingUnitsAtMost !== undefined && trigger.event !== 'package_expiring') {
      issues.push('remainingUnitsAtMost yalnızca package_expiring tetikleyicisinde kullanılır');
    }
  }

  for (const [id, step] of Object.entries(definition.steps)) {
    if (step.type === 'wait' && (step.minutes === undefined) === (step.untilLocalTime === undefined)) {
      issues.push(`${id}: bekleme için ya süre ya da saat verilmeli`);
    }
    if (step.type === 'send' && (step.templateId === undefined) === (step.templateKey === undefined)) {
      issues.push(`${id}: şablon için ya templateId ya da templateKey verilmeli`);
    }
    if (step.type === 'create_task' && step.assignTo !== 'CONTACT_OWNER' && !step.assigneeId) {
      issues.push(`${id}: görev ataması için assigneeId gerekli`);
    }
    if (step.type in UNAVAILABLE_JOURNEY_STEP_TYPES) {
      issues.push(`${id}: ${UNAVAILABLE_JOURNEY_STEP_TYPES[step.type as keyof typeof UNAVAILABLE_JOURNEY_STEP_TYPES]}`);
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

/** Successor step ids of a step (branch has two). */
export function journeyStepSuccessors(step: JourneyStep): Array<string | null> {
  return step.type === 'branch' ? [step.ifTrue, step.ifFalse] : [step.next];
}

function localParts(date: Date, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute') };
}

/** The UTC instant of a wall-clock time in `timeZone` (two corrections converge for every real zone). */
export function instantForLocalTime(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  let guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  for (let i = 0; i < 2; i += 1) {
    const local = localParts(new Date(guess), timeZone);
    const offset = Date.UTC(local.y, local.mo - 1, local.d, local.h, local.mi, 0) - guess;
    guess = Date.UTC(y, mo - 1, d, h, mi, 0) - offset;
  }
  return new Date(guess);
}

/**
 * The first instant strictly after `after` whose wall-clock time in
 * `timeZone` is `hhmm` ("HH:MM"). An unknown zone falls back to UTC so a
 * bad contact time zone never stalls a journey.
 */
export function nextLocalTime(after: Date, hhmm: string, timeZone: string | null | undefined): Date {
  const [h, mi] = hhmm.split(':').map(Number);
  let zone = timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(after);
  } catch {
    zone = 'UTC';
  }
  const local = localParts(after, zone);
  const today = instantForLocalTime(local.y, local.mo, local.d, h, mi, zone);
  if (today.getTime() > after.getTime()) return today;
  const tomorrow = new Date(Date.UTC(local.y, local.mo - 1, local.d + 1));
  return instantForLocalTime(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), h, mi, zone);
}
