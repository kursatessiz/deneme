import type { AutomationRuleType, AutomationRuleParams } from '@platform/shared';

/** Default cap on candidates fetched per rule per evaluation cycle. */
export const AUTOMATION_BATCH_LIMIT = 200;

/**
 * One recipient found by an evaluator: the user to message, the entity that
 * triggered the rule (used as the idempotency key together with the rule),
 * when the message is logically "due", and the placeholders its template
 * needs.
 */
export interface AutomationCandidate {
  userId: string;
  targetRef: string;
  scheduledFor: Date;
  templateParams: Record<string, string>;
}

export interface RuleEvaluator {
  readonly type: AutomationRuleType;
  findCandidates(
    studioId: string,
    params: Extract<AutomationRuleParams, { type: AutomationRuleType }>,
    now: Date,
    limit?: number,
  ): Promise<AutomationCandidate[]>;
}

export const RULE_EVALUATORS = 'RULE_EVALUATORS';

/** ISO-week bucket key, e.g. "2026-W04", used to cap repeat-marketing cadence. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function formatDateTr(date: Date, timeZone = 'Europe/Istanbul'): string {
  return date.toLocaleString('tr-TR', { timeZone, dateStyle: 'short', timeStyle: 'short' });
}
