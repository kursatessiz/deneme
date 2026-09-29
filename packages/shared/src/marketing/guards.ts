import { z } from 'zod';

/**
 * Guards of the platform's own marketing (M3d, docs/PAZARLAMA_MODULU.md 6.2):
 * the e-mail deliverability fuse, the daily send caps with the warm-up plan,
 * the monthly ad spend cap per currency and the ISO week arithmetic of the
 * weekly summary. Everything here is pure so the API, the dashboard and the
 * unit tests share one definition.
 */

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Time windows
// ---------------------------------------------------------------------------

/** 00:00 UTC of the day `date` falls in. */
export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** 00:00 UTC of the first day of the month `date` falls in. */
export function utcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** "YYYY-MM" of the UTC month. */
export function utcMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 00:00 UTC of the next day: when a daily cap opens again. */
export function nextCapWindowStart(now: Date): Date {
  return new Date(utcDayStart(now).getTime() + DAY_MS);
}

/** Monday 00:00 UTC of the ISO week `date` falls in. */
export function isoWeekStart(date: Date): Date {
  const day = utcDayStart(date);
  const weekday = (day.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(day.getTime() - weekday * DAY_MS);
}

/** "YYYY-MM-DD" (UTC) of a date. */
export function isoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface InsightWeek {
  /** Monday (UTC) of the summarised week; with the studio it is the unique key of an insight. */
  periodStart: Date;
  /** Sunday (UTC) of the summarised week, inclusive (a date, 00:00 UTC). */
  periodEnd: Date;
  /** Query range of the summarised week: Monday 00:00 through Sunday 23:59:59.999. */
  current: { from: Date; to: Date };
  /** The week before, same convention. */
  previous: { from: Date; to: Date };
}

/**
 * The week a heartbeat at `now` summarises: the last complete ISO week (the
 * one that ended at the most recent Monday 00:00 UTC) against the week
 * before it. Every instant of one week maps to the same result, which is what
 * makes generating it once per week idempotent.
 */
export function insightWeekFor(now: Date): InsightWeek {
  const thisMonday = isoWeekStart(now);
  const periodStart = new Date(thisMonday.getTime() - 7 * DAY_MS);
  const previousStart = new Date(periodStart.getTime() - 7 * DAY_MS);
  return {
    periodStart,
    periodEnd: new Date(thisMonday.getTime() - DAY_MS),
    current: { from: periodStart, to: new Date(thisMonday.getTime() - 1) },
    previous: { from: previousStart, to: new Date(periodStart.getTime() - 1) },
  };
}

// ---------------------------------------------------------------------------
// Deliverability fuse
// ---------------------------------------------------------------------------

/** The fuse looks at the last 24 hours of the platform tenant's e-mail. */
export const FUSE_WINDOW_HOURS = 24;
export const FUSE_REASONS = ['BOUNCE', 'COMPLAINT'] as const;
export type FuseReason = (typeof FUSE_REASONS)[number];
/** Stored in campaigns.pause_reason when the system paused the campaign. */
export const FUSE_PAUSE_REASON_CODES: Readonly<Record<FuseReason, string>> = { BOUNCE: 'AUTO_BOUNCE', COMPLAINT: 'AUTO_COMPLAINT' };
export type CampaignPauseReasonCode = (typeof FUSE_PAUSE_REASON_CODES)[FuseReason];
/** The same alert is sent at most once per this many hours per reason. */
export const FUSE_ALERT_INTERVAL_HOURS = 24;

/** numerator / denominator, or null when there is nothing to divide by. */
export function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export interface FuseInput {
  /** E-mails the provider accepted in the window (sent, delivered, bounced, complained). */
  sent: number;
  bounced: number;
  complained: number;
  /** Percent, e.g. 2 means 2 %. */
  bouncePausePct: number;
  complaintPausePct: number;
}

export interface FuseResult {
  bounceRate: number | null;
  complaintRate: number | null;
  /** The reasons whose rate is strictly above its threshold; empty when nothing was sent. */
  tripped: FuseReason[];
}

/** Bounce and complaint rates of the window against the auto-pause thresholds (strictly above trips; no e-mail, no verdict). */
export function evaluateEmailFuse(input: FuseInput): FuseResult {
  const bounceRate = safeRate(input.bounced, input.sent);
  const complaintRate = safeRate(input.complained, input.sent);
  const tripped: FuseReason[] = [];
  if (bounceRate !== null && bounceRate * 100 > input.bouncePausePct) tripped.push('BOUNCE');
  if (complaintRate !== null && complaintRate * 100 > input.complaintPausePct) tripped.push('COMPLAINT');
  return { bounceRate, complaintRate, tripped };
}

/** The campaign pause reason to store for the tripped reasons (bounce first). */
export function pauseReasonFor(tripped: readonly FuseReason[]): CampaignPauseReasonCode | null {
  const first = tripped[0];
  return first ? FUSE_PAUSE_REASON_CODES[first] : null;
}

/** True when a campaign in `status` on `channel` is held by the e-mail fuse: it sends or will send e-mail (an unset channel follows the tenant order, which may start with e-mail). */
export function isFuseTarget(campaign: { status: string; channel: string | null }): boolean {
  return (campaign.status === 'SENDING' || campaign.status === 'SCHEDULED') && (campaign.channel === 'EMAIL' || campaign.channel === null);
}

// ---------------------------------------------------------------------------
// Daily caps and the warm-up plan
// ---------------------------------------------------------------------------

/** Daily e-mail caps of the first days after the sender domain was verified: [day 1, day 2, ...]. */
export const EMAIL_WARMUP_MAX_DAYS = 90;
export const EmailWarmupPlanSchema = z.array(z.number().int().min(1).max(100_000_000)).min(1).max(EMAIL_WARMUP_MAX_DAYS);
export type EmailWarmupPlan = z.infer<typeof EmailWarmupPlanSchema>;

/** A stored plan (JSON), or null when it is absent or malformed. */
export function parseWarmupPlan(raw: unknown): EmailWarmupPlan | null {
  const parsed = EmailWarmupPlanSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Day 1 is the UTC day the domain was verified. */
export function warmupDayOf(startedAt: Date, now: Date): number {
  return Math.floor((utcDayStart(now).getTime() - utcDayStart(startedAt).getTime()) / DAY_MS) + 1;
}

/** The plan's cap for `now`, or null once the plan is over (or before it starts). */
export function warmupCapFor(plan: readonly number[] | null, startedAt: Date | null, now: Date): { day: number; cap: number } | null {
  if (!plan || plan.length === 0 || !startedAt) return null;
  const day = warmupDayOf(startedAt, now);
  const cap = day >= 1 ? plan[day - 1] : undefined;
  return cap === undefined ? null : { day, cap };
}

export type EmailCapSource = 'NONE' | 'CONFIGURED' | 'WARMUP';

export interface EffectiveEmailCap {
  /** Null: no cap. */
  cap: number | null;
  source: EmailCapSource;
  /** Day of the warm-up plan when it is active. */
  warmupDay: number | null;
}

/** The lower of the configured daily cap and the warm-up plan's cap of the day; no plan (or an ended one) leaves the configured cap. */
export function effectiveEmailCap(input: { dailyCap: number | null; warmupPlan: readonly number[] | null; warmupStartedAt: Date | null; now: Date }): EffectiveEmailCap {
  const warm = warmupCapFor(input.warmupPlan, input.warmupStartedAt, input.now);
  if (warm && (input.dailyCap === null || warm.cap < input.dailyCap)) return { cap: warm.cap, source: 'WARMUP', warmupDay: warm.day };
  if (input.dailyCap !== null) return { cap: input.dailyCap, source: 'CONFIGURED', warmupDay: warm?.day ?? null };
  return { cap: null, source: 'NONE', warmupDay: warm?.day ?? null };
}

/** How many more messages fit under a cap today; null for no cap. */
export function remainingCap(cap: number | null, used: number): number | null {
  return cap === null ? null : Math.max(0, cap - Math.max(0, used));
}

/** Splits `wanted` messages into what goes out now and what waits for the next day. */
export function splitByCap(cap: number | null, used: number, wanted: number): { send: number; defer: number } {
  const room = remainingCap(cap, used);
  const want = Math.max(0, wanted);
  if (room === null) return { send: want, defer: 0 };
  const send = Math.min(want, room);
  return { send, defer: want - send };
}

/** Marker stored as the reason code of a recipient held back by a cap (it stays PENDING). */
export const CAP_DEFERRED_REASON_CODES = { EMAIL: 'DAILY_EMAIL_CAP', SMS: 'DAILY_SMS_CAP' } as const;
export type CapChannel = keyof typeof CAP_DEFERRED_REASON_CODES;

// ---------------------------------------------------------------------------
// Monthly ad spend cap (per currency)
// ---------------------------------------------------------------------------

export const AdSpendCapStatusSchema = z
  .object({
    currency: z.string().length(3),
    /** Decimal text, as configured. */
    cap: z.string(),
    /** Month-to-date campaign spend, decimal text with two decimals. */
    spent: z.string(),
    exceeded: z.boolean(),
    /** spent / cap; null when the cap is 0. */
    ratio: z.number().nullable(),
  })
  .strict();
export type AdSpendCapStatus = z.infer<typeof AdSpendCapStatusSchema>;

const SCALE = 4;

/** A decimal text as an integer of 1/10000 units (exact, no floating point). */
function scaled(amount: string): bigint {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = amount.replace('-', '').split('.');
  const value = BigInt(whole || '0') * 10n ** BigInt(SCALE) + BigInt((fraction + '0'.repeat(SCALE)).slice(0, SCALE));
  return negative ? -value : value;
}

/**
 * Month-to-date spend against the monthly cap, per currency (currencies are
 * never added together). A currency without a cap is not listed; one with a
 * cap and no spend shows 0. Exceeded means strictly above the cap.
 */
export function adSpendCapStatuses(caps: Readonly<Record<string, string>>, spent: Readonly<Record<string, string>>): AdSpendCapStatus[] {
  return Object.keys(caps)
    .sort()
    .map((currency) => {
      const cap = caps[currency] ?? '0';
      const total = spent[currency] ?? '0';
      const capScaled = scaled(cap);
      const totalScaled = scaled(total);
      return {
        currency,
        cap,
        spent: (Number(totalScaled) / 10 ** SCALE).toFixed(2),
        exceeded: totalScaled > capScaled,
        ratio: capScaled > 0n ? Number(totalScaled) / Number(capScaled) : null,
      };
    });
}

/** Key of the once-per-month-per-currency alert of an exceeded ad spend cap. */
export function adSpendAlertKey(currency: string, now: Date): string {
  return `ad_cap:${currency}:${utcMonthKey(now)}`;
}

/** Key of the once-per-24-hours alert of a tripped fuse reason. */
export function fuseAlertKey(reason: FuseReason): string {
  return `fuse:${reason}`;
}

/** Built-in template keys of the M3d notices (message-templates.ts). */
export const MARKETING_GUARD_TEMPLATE_KEYS = {
  weeklySummary: 'MARKETING_WEEKLY_SUMMARY',
  fuseTripped: 'MARKETING_EMAIL_FUSE_TRIPPED',
  adCapExceeded: 'MARKETING_AD_CAP_EXCEEDED',
} as const;

/**
 * Room left under the day's caps while a campaign sends. `null` means no cap.
 * A campaign on a channel with no room stops (its rest is deferred to the
 * next UTC day); a campaign without a fixed channel follows the tenant order,
 * so it stops as soon as either capped channel is full (conservative).
 */
export class DailyCapTracker {
  constructor(
    private emailRoom: number | null,
    private smsRoom: number | null,
  ) {}

  /** The capped channel that has no room for a campaign on `channel`, or null when it may send. */
  blockedBy(channel: string | null): CapChannel | null {
    if ((channel === 'EMAIL' || channel === null) && this.emailRoom !== null && this.emailRoom <= 0) return 'EMAIL';
    if ((channel === 'SMS' || channel === null) && this.smsRoom !== null && this.smsRoom <= 0) return 'SMS';
    return null;
  }

  /** Books one accepted message of `channel` (an e-mail, or an SMS at one credit). */
  consume(channel: string | null): void {
    if (channel === 'EMAIL' && this.emailRoom !== null) this.emailRoom -= 1;
    if (channel === 'SMS' && this.smsRoom !== null) this.smsRoom -= 1;
  }

  get remaining(): { email: number | null; sms: number | null } {
    return { email: this.emailRoom, sms: this.smsRoom };
  }
}
