import { UsageRuleSchema, USAGE_REMINDER_DEFAULT_DAYS, translateValidationMessage, usageRuleKindIssue, vmsg } from '@platform/shared';
import type { Translate, UsageRule, UsageTierUnit } from '@platform/shared';

/** Month calculation as the editor offers it: one select instead of a mode plus a day count. */
export type MonthChoice = 'CALENDAR' | 'FIXED_30' | 'FIXED_31';

export interface TierFormState {
  unit: UsageTierUnit;
  length: number;
  monthChoice: MonthChoice;
  quota: number;
  expireUnused: boolean;
}

export interface RuleFormState {
  tiers: TierFormState[];
  reminderDaysBefore: number;
}

export function emptyTier(unit: UsageTierUnit = 'MONTH'): TierFormState {
  return { unit, length: 1, monthChoice: 'CALENDAR', quota: 1, expireUnused: false };
}

export function emptyRuleForm(): RuleFormState {
  return { tiers: [{ ...emptyTier('MONTH'), expireUnused: true }], reminderDaysBefore: USAGE_REMINDER_DEFAULT_DAYS };
}

/** The unit a second tier starts with: the finest one not used yet. */
export function nextTierUnit(form: RuleFormState): UsageTierUnit {
  const used = new Set(form.tiers.map((tier) => tier.unit));
  return (['WEEK', 'MONTH', 'DAYS'] as const).find((unit) => !used.has(unit)) ?? 'WEEK';
}

export function ruleToForm(rule: UsageRule): RuleFormState {
  return {
    reminderDaysBefore: rule.reminderDaysBefore,
    tiers: rule.tiers.map((tier) => ({
      unit: tier.unit,
      length: tier.length,
      monthChoice: tier.monthMode === 'FIXED_DAYS' ? (tier.fixedMonthDays === 31 ? 'FIXED_31' : 'FIXED_30') : 'CALENDAR',
      quota: tier.quota,
      expireUnused: tier.expireUnused,
    })),
  };
}

/** The rule payload of a form. An unlimited package never burns, whatever the toggle says. */
export function formToRuleInput(form: RuleFormState, entitlementKind: string): unknown {
  return {
    version: 1,
    reminderDaysBefore: form.reminderDaysBefore,
    tiers: form.tiers.map((tier) => ({
      unit: tier.unit,
      length: tier.length,
      ...(tier.unit === 'MONTH'
        ? tier.monthChoice === 'CALENDAR'
          ? { monthMode: 'CALENDAR' }
          : { monthMode: 'FIXED_DAYS', fixedMonthDays: tier.monthChoice === 'FIXED_31' ? 31 : 30 }
        : {}),
      quota: tier.quota,
      expireUnused: entitlementKind === 'TIME_UNLIMITED' ? false : tier.expireUnused,
    })),
  };
}

export interface RuleFormIssue {
  /** Index of the tier the problem belongs to, null for the rule as a whole. */
  tierIndex: number | null;
  field: string | null;
  /** Message in the active language. */
  message: string;
}

export type RuleFormResult = { ok: true; rule: UsageRule } | { ok: false; issues: RuleFormIssue[] };

/** Validates a form with the shared schema (the same one the API uses) and the package-kind check. */
export function validateRuleForm(form: RuleFormState, entitlementKind: string, t: Translate): RuleFormResult {
  const parsed = UsageRuleSchema.safeParse(formToRuleInput(form, entitlementKind));
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => {
        const [head, index, field] = issue.path;
        const tierIndex = head === 'tiers' && typeof index === 'number' ? index : null;
        return { tierIndex, field: typeof field === 'string' ? field : null, message: translateValidationMessage(issue.message, t) };
      }),
    };
  }
  const kindIssue = usageRuleKindIssue(parsed.data, entitlementKind);
  if (kindIssue) return { ok: false, issues: [{ tierIndex: null, field: null, message: translateValidationMessage(vmsg(kindIssue), t) }] };
  return { ok: true, rule: parsed.data };
}
