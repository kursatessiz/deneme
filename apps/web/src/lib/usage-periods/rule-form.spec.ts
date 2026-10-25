import { BASE_MESSAGES, BUNDLED_MESSAGES, createTranslator, describeUsageRule } from '@platform/shared';
import type { UsageRule } from '@platform/shared';
import { emptyRuleForm, formToRuleInput, nextTierUnit, ruleToForm, validateRuleForm } from './rule-form';
import type { RuleFormState } from './rule-form';

const tr = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });
const en = createTranslator({ locale: 'en', messages: BUNDLED_MESSAGES.en, fallback: BASE_MESSAGES });

const monthAndWeek: RuleFormState = {
  reminderDaysBefore: 3,
  tiers: [
    { unit: 'MONTH', length: 1, monthChoice: 'CALENDAR', quota: 8, expireUnused: true },
    { unit: 'WEEK', length: 1, monthChoice: 'CALENDAR', quota: 2, expireUnused: false },
  ],
};

describe('validateRuleForm', () => {
  it('turns a valid form into a rule whose summary reads like the owner example', () => {
    const result = validateRuleForm(monthAndWeek, 'SESSION_COUNT', tr);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(describeUsageRule(tr, result.rule, 'SESSION_COUNT')).toContain('Ayda 8 seans; kullanılmayan haklar dönem sonunda yanar. Haftada en fazla 2 seans.');
  });

  it('maps the month select to month mode and fixed days, and drops them for other units', () => {
    const fixed: RuleFormState = { reminderDaysBefore: 0, tiers: [{ unit: 'MONTH', length: 1, monthChoice: 'FIXED_31', quota: 4, expireUnused: true }] };
    expect(formToRuleInput(fixed, 'SESSION_COUNT')).toMatchObject({ tiers: [{ unit: 'MONTH', monthMode: 'FIXED_DAYS', fixedMonthDays: 31 }] });
    const weekly: RuleFormState = { reminderDaysBefore: 0, tiers: [{ unit: 'WEEK', length: 1, monthChoice: 'FIXED_31', quota: 4, expireUnused: false }] };
    const input = formToRuleInput(weekly, 'SESSION_COUNT') as { tiers: Record<string, unknown>[] };
    expect(input.tiers[0]).not.toHaveProperty('monthMode');
    expect(input.tiers[0]).not.toHaveProperty('fixedMonthDays');
  });

  it('never burns on an unlimited package', () => {
    const result = validateRuleForm(monthAndWeek, 'TIME_UNLIMITED', tr);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule.tiers.every((tier) => !tier.expireUnused)).toBe(true);
  });

  it('reports shared-schema problems per tier in the active language', () => {
    const bad: RuleFormState = { reminderDaysBefore: 3, tiers: [{ unit: 'WEEK', length: 9, monthChoice: 'CALENDAR', quota: 0, expireUnused: false }] };
    const trResult = validateRuleForm(bad, 'SESSION_COUNT', tr);
    expect(trResult.ok).toBe(false);
    if (trResult.ok) return;
    const byField = Object.fromEntries(trResult.issues.map((i) => [i.field, i]));
    expect(byField.length.tierIndex).toBe(0);
    expect(byField.length.message).toBe('Dönem uzunluğu 1 ile 8 arasında olmalıdır');
    expect(byField.quota.message).toBe('Dönem hakkı en az 1 olmalıdır');
    const enResult = validateRuleForm(bad, 'SESSION_COUNT', en);
    if (!enResult.ok) expect(enResult.issues.some((i) => i.message.includes('between 1 and 8'))).toBe(true);
  });

  it('reports a finer quota above the coarser one and a reminder out of range at rule level', () => {
    const form: RuleFormState = {
      reminderDaysBefore: 20,
      tiers: [
        { unit: 'MONTH', length: 1, monthChoice: 'CALENDAR', quota: 4, expireUnused: true },
        { unit: 'WEEK', length: 1, monthChoice: 'CALENDAR', quota: 5, expireUnused: false },
      ],
    };
    const result = validateRuleForm(form, 'SESSION_COUNT', tr);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.tierIndex === null && i.message === 'Kısa dönemin hakkı uzun dönemin hakkından fazla olamaz')).toBe(true);
    expect(result.issues.some((i) => i.field === null && i.message.includes('0 ile 14'))).toBe(true);
  });

  it('rejects two tiers with the same unit', () => {
    const form: RuleFormState = { reminderDaysBefore: 3, tiers: [monthAndWeek.tiers[1], monthAndWeek.tiers[1]] };
    const result = validateRuleForm(form, 'SESSION_COUNT', tr);
    expect(result.ok).toBe(false);
  });
});

describe('form helpers', () => {
  it('round-trips a stored rule through the form', () => {
    const rule: UsageRule = {
      version: 1,
      reminderDaysBefore: 5,
      tiers: [
        { unit: 'MONTH', length: 2, monthMode: 'FIXED_DAYS', fixedMonthDays: 30, quota: 10, expireUnused: true },
        { unit: 'DAYS', length: 10, quota: 3, expireUnused: false },
      ],
    };
    const result = validateRuleForm(ruleToForm(rule), 'SESSION_COUNT', tr);
    expect(result).toEqual({ ok: true, rule });
  });

  it('starts with one burning month tier and offers the next free unit for a second tier', () => {
    const form = emptyRuleForm();
    expect(form.tiers).toHaveLength(1);
    expect(form.tiers[0]).toMatchObject({ unit: 'MONTH', expireUnused: true });
    expect(nextTierUnit(form)).toBe('WEEK');
    expect(nextTierUnit(monthAndWeek)).toBe('DAYS');
  });
});
