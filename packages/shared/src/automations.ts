import { z } from 'zod';

/**
 * W10: automated marketing and lifecycle flows. Rules are tenant data
 * (rule 7): the six types below are the catalogue of evaluators the API
 * ships, but every threshold, template and channel choice is configured
 * per tenant, not hardcoded. See CLAUDE.md rule 8 and docs/AUTOMATIONS.md.
 */

export const AUTOMATION_RULE_TYPES = [
  'WIN_BACK',
  'PACKAGE_EXPIRING',
  'BIRTHDAY',
  'FIRST_CLASS_FOLLOW_UP',
  'BOOKING_REMINDER',
  'NO_SHOW_FOLLOW_UP',
] as const;
export type AutomationRuleType = (typeof AUTOMATION_RULE_TYPES)[number];

/**
 * Reminders and follow-ups concern the member's own booking, so they are
 * transactional/utility messages and bypass İYS consent gating. Win-back and
 * birthday messages are unsolicited outreach, so they are marketing and
 * require explicit commercial consent (CLAUDE.md: never bypass İYS consent
 * for non-transactional messages).
 */
const MARKETING_RULE_TYPES: ReadonlySet<AutomationRuleType> = new Set(['WIN_BACK', 'BIRTHDAY']);

export function isTransactionalRuleType(type: AutomationRuleType): boolean {
  return !MARKETING_RULE_TYPES.has(type);
}

const WinBackParamsSchema = z
  .object({
    type: z.literal('WIN_BACK'),
    /** No ATTENDED booking in the last N days. */
    noAttendanceDays: z.number().int().min(1).max(3650),
    /** Only target members with no currently active package. */
    requireNoActivePackage: z.boolean().default(true),
  })
  .strict();

const PackageExpiringParamsSchema = z
  .object({
    type: z.literal('PACKAGE_EXPIRING'),
    /** Package ends within this many days (inclusive). */
    daysBefore: z.number().int().min(0).max(90).optional(),
    /** Or has at most this many remaining units (credit/session-count packages). */
    remainingUnitsAtMost: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

const BirthdayParamsSchema = z
  .object({
    type: z.literal('BIRTHDAY'),
    /** 0 = send on the birthday itself; positive = that many days before. */
    daysBefore: z.number().int().min(0).max(30).default(0),
  })
  .strict();

const FirstClassFollowUpParamsSchema = z
  .object({
    type: z.literal('FIRST_CLASS_FOLLOW_UP'),
    /** Hours after the member's first ATTENDED booking. */
    hoursAfter: z.number().int().min(1).max(720),
  })
  .strict();

const BookingReminderParamsSchema = z
  .object({
    type: z.literal('BOOKING_REMINDER'),
    /** Hours before the booked session starts. */
    hoursBefore: z.number().int().min(1).max(168),
  })
  .strict();

const NoShowFollowUpParamsSchema = z
  .object({
    type: z.literal('NO_SHOW_FOLLOW_UP'),
    /** Hours after the session's start time (i.e. after the no-show is recorded). */
    hoursAfter: z.number().int().min(1).max(720),
  })
  .strict();

export const AutomationRuleParamsSchema = z.discriminatedUnion('type', [
  WinBackParamsSchema,
  PackageExpiringParamsSchema,
  BirthdayParamsSchema,
  FirstClassFollowUpParamsSchema,
  BookingReminderParamsSchema,
  NoShowFollowUpParamsSchema,
]);
export type AutomationRuleParams = z.infer<typeof AutomationRuleParamsSchema>;

export type WinBackParams = z.infer<typeof WinBackParamsSchema>;
export type PackageExpiringParams = z.infer<typeof PackageExpiringParamsSchema>;
export type BirthdayParams = z.infer<typeof BirthdayParamsSchema>;
export type FirstClassFollowUpParams = z.infer<typeof FirstClassFollowUpParamsSchema>;
export type BookingReminderParams = z.infer<typeof BookingReminderParamsSchema>;
export type NoShowFollowUpParams = z.infer<typeof NoShowFollowUpParamsSchema>;

export const AUTOMATION_CHANNELS = ['WHATSAPP', 'SMS'] as const;

export const CreateAutomationRuleSchema = z
  .object({
    type: z.enum(AUTOMATION_RULE_TYPES),
    name: z.string().trim().min(1, 'Ad zorunludur').max(100),
    params: AutomationRuleParamsSchema,
    templateKey: z.string().trim().min(1).max(60),
    channel: z.enum(AUTOMATION_CHANNELS).optional(),
    isActive: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.type === v.params.type, {
    message: 'params.type, type alanıyla eşleşmelidir',
    path: ['params', 'type'],
  })
  .refine(
    (v) =>
      v.params.type !== 'PACKAGE_EXPIRING' ||
      v.params.daysBefore !== undefined ||
      v.params.remainingUnitsAtMost !== undefined,
    {
      message: 'daysBefore veya remainingUnitsAtMost alanlarından en az biri girilmelidir',
      path: ['params'],
    },
  );
export type CreateAutomationRuleInput = z.infer<typeof CreateAutomationRuleSchema>;

export const UpdateAutomationRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    params: AutomationRuleParamsSchema.optional(),
    templateKey: z.string().trim().min(1).max(60).optional(),
    channel: z.enum(AUTOMATION_CHANNELS).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.params?.type !== 'PACKAGE_EXPIRING' ||
      v.params.daysBefore !== undefined ||
      v.params.remainingUnitsAtMost !== undefined,
    {
      message: 'daysBefore veya remainingUnitsAtMost alanlarından en az biri girilmelidir',
      path: ['params'],
    },
  );
export type UpdateAutomationRuleInput = z.infer<typeof UpdateAutomationRuleSchema>;

export const ToggleAutomationRuleSchema = z.object({ isActive: z.boolean() }).strict();
export type ToggleAutomationRuleInput = z.infer<typeof ToggleAutomationRuleSchema>;

export const AutomationRunHistoryQuerySchema = z
  .object({
    ruleId: z.string().uuid().optional(),
    status: z.enum(['SENT', 'SKIPPED', 'FAILED']).optional(),
    take: z.coerce.number().int().min(1).max(200).default(50),
    skip: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type AutomationRunHistoryQuery = z.infer<typeof AutomationRunHistoryQuerySchema>;

// ---------------------------------------------------------------------------
// Quiet hours: no sends between 21:00 and 09:00 studio local time.
// ---------------------------------------------------------------------------

export const QUIET_HOURS_START = 21;
export const QUIET_HOURS_END = 9;

function localPartsInTimeZone(date: Date, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute') };
}

/** Hour-of-day (0-23) in the given IANA timezone for a given instant. */
export function localHourInTimeZone(date: Date, timeZone: string): number {
  try {
    return localPartsInTimeZone(date, timeZone).h;
  } catch {
    return date.getUTCHours();
  }
}

export function isWithinQuietHours(date: Date, timeZone: string): boolean {
  const hour = localHourInTimeZone(date, timeZone);
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

/** The UTC instant for a given local wall-clock time in `timeZone`. */
function instantForLocalTime(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  let guessMs = Date.UTC(y, mo - 1, d, h, mi, 0);
  // Two corrections converge for any real-world zone (max UTC offset ~14h).
  for (let i = 0; i < 2; i += 1) {
    const local = localPartsInTimeZone(new Date(guessMs), timeZone);
    const localAsUtcMs = Date.UTC(local.y, local.mo - 1, local.d, local.h, local.mi, 0);
    const offsetMs = localAsUtcMs - guessMs;
    guessMs = Date.UTC(y, mo - 1, d, h, mi, 0) - offsetMs;
  }
  return new Date(guessMs);
}

/**
 * If `date` falls within quiet hours in the studio's timezone, returns the
 * instant of the next 09:00 local time; otherwise returns `date` unchanged.
 */
export function deferForQuietHours(date: Date, timeZone: string): Date {
  const local = localPartsInTimeZone(date, timeZone);
  if (local.h < QUIET_HOURS_START && local.h >= QUIET_HOURS_END) return date;

  let y = local.y;
  let mo = local.mo;
  let d = local.d;
  if (local.h >= QUIET_HOURS_START) {
    const next = new Date(Date.UTC(local.y, local.mo - 1, local.d + 1));
    y = next.getUTCFullYear();
    mo = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return instantForLocalTime(y, mo, d, QUIET_HOURS_END, 0, timeZone);
}
