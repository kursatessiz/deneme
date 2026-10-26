'use client';

import { useState } from 'react';
import { USAGE_TIER_UNITS, describeUsageRule } from '@platform/shared';
import type { UsageRule, UsageTierUnit } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Checkbox } from '@/components/ui/Checkbox';
import { InlineMessage } from '@/components/settings/ui';
import { emptyRuleForm, emptyTier, nextTierUnit, ruleToForm, validateRuleForm } from '@/lib/usage-periods/rule-form';
import type { MonthChoice, RuleFormIssue, RuleFormState, TierFormState } from '@/lib/usage-periods/rule-form';

interface UsageRuleEditorProps {
  studioId: string;
  definition: { id: string; name: string; entitlementKind: string; usageRule?: UsageRule | null };
  /** catalog.manage: without it the rule is only shown. */
  canManage: boolean;
  /** Studio switch; null when the viewer cannot read it. */
  switchEnabled: boolean | null;
  onSaved: () => void;
}

const MONTH_CHOICES: readonly MonthChoice[] = ['CALENDAR', 'FIXED_30', 'FIXED_31'];

/** Rule of one package definition: a readable summary, and a small editor with up to two tiers. */
export function UsageRuleEditor({ studioId, definition, canManage, switchEnabled, onSaved }: UsageRuleEditorProps) {
  const t = useT();
  const rule = definition.usageRule ?? null;
  const [form, setForm] = useState<RuleFormState | null>(null);
  const [issues, setIssues] = useState<RuleFormIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const unlimited = definition.entitlementKind === 'TIME_UNLIMITED';

  const preview = form ? validateRuleForm(form, definition.entitlementKind, t) : null;
  const previewText = preview?.ok ? describeUsageRule(t, preview.rule, definition.entitlementKind) : null;

  function patchTier(index: number, patch: Partial<TierFormState>) {
    setForm((f) => (f ? { ...f, tiers: f.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)) } : f));
  }

  async function send(usageRule: UsageRule | null) {
    setBusy(true);
    setServerError(null);
    try {
      await bffFetch(`catalog/package-definitions/${definition.id}/usage-rule`, { method: 'PATCH', body: { usageRule }, studioId });
      setForm(null);
      setMessage(t(usageRule ? 'usagePeriods.editor.saved' : 'usagePeriods.editor.removed'));
      onSaved();
    } catch (err) {
      setServerError(err instanceof BffError ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!form) return;
    const result = validateRuleForm(form, definition.entitlementKind, t);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setIssues([]);
    void send(result.rule);
  }

  function open() {
    setMessage(null);
    setServerError(null);
    setIssues([]);
    setForm(rule ? ruleToForm(rule) : emptyRuleForm());
  }

  const ruleIssues = issues.filter((i) => i.tierIndex === null);

  return (
    <section className="pui-card" aria-label={t('usagePeriods.editor.title')}>
      <div className="pui-card-content gap-3">
        <h4 className="ui-heading">{t('usagePeriods.editor.title')}</h4>
        {switchEnabled === false && <InlineMessage text={t('usagePeriods.editor.switchOff')} />}

        {!form && (
          <>
            {rule ? (
              <p data-testid="usage-rule-summary">{describeUsageRule(t, rule, definition.entitlementKind)}</p>
            ) : (
              <p className="ui-caption">{t('usagePeriods.editor.noRule')}</p>
            )}
            {message && <InlineMessage text={message} tone="success" />}
            {serverError && <InlineMessage text={serverError} tone="error" />}
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" tone="surface" onClick={open}>
                  {t(rule ? 'usagePeriods.editor.edit' : 'usagePeriods.editor.add')}
                </Button>
                {rule && (
                  <Button size="sm" variant="outline" tone="error" disabled={busy} onClick={() => void send(null)}>
                    {t('usagePeriods.editor.removeRule')}
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        {form && (
          <div className="grid gap-4">
            {form.tiers.map((tier, index) => {
              const own = issues.filter((i) => i.tierIndex === index);
              const issueOf = (field: string) => own.find((i) => i.field === field)?.message;
              return (
                <fieldset key={index} className="grid gap-3">
                  <legend className="ui-strong">{t('usagePeriods.editor.tier', { n: index + 1 })}</legend>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <FieldGroup label={t('usagePeriods.editor.unit')}>
                      <Select value={tier.unit} onChange={(e) => patchTier(index, { unit: e.target.value as UsageTierUnit })}>
                        {USAGE_TIER_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {t(`usagePeriods.editor.unit.${unit}`)}
                          </option>
                        ))}
                      </Select>
                    </FieldGroup>
                    <FieldGroup label={t('usagePeriods.editor.length')} error={issueOf('length')}>
                      <Input type="number" min={1} value={tier.length} invalid={!!issueOf('length')} onChange={(e) => patchTier(index, { length: Number(e.target.value) })} />
                    </FieldGroup>
                    {tier.unit === 'MONTH' && (
                      <FieldGroup label={t('usagePeriods.editor.monthMode')}>
                        <Select value={tier.monthChoice} onChange={(e) => patchTier(index, { monthChoice: e.target.value as MonthChoice })}>
                          {MONTH_CHOICES.map((choice) => (
                            <option key={choice} value={choice}>
                              {t(`usagePeriods.editor.monthMode.${choice}`)}
                            </option>
                          ))}
                        </Select>
                      </FieldGroup>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <FieldGroup label={t(`usagePeriods.editor.quota.${definition.entitlementKind === 'CREDIT' || unlimited ? definition.entitlementKind : 'SESSION_COUNT'}`)} error={issueOf('quota')}>
                      <Input type="number" min={1} value={tier.quota} invalid={!!issueOf('quota')} onChange={(e) => patchTier(index, { quota: Number(e.target.value) })} />
                    </FieldGroup>
                  </div>
                  <Checkbox
                    label={t('usagePeriods.editor.expireUnused')}
                    checked={unlimited ? false : tier.expireUnused}
                    disabled={unlimited}
                    onChange={(e) => patchTier(index, { expireUnused: e.target.checked })}
                  />
                  {unlimited && <InlineMessage text={t('usagePeriods.editor.expireUnusedUnlimited')} />}
                  {form.tiers.length > 1 && (
                    <div>
                      <Button size="sm" variant="link" tone="error" onClick={() => setForm({ ...form, tiers: form.tiers.filter((_, i) => i !== index) })}>
                        {t('usagePeriods.editor.removeTier')}
                      </Button>
                    </div>
                  )}
                </fieldset>
              );
            })}

            {form.tiers.length < 2 && (
              <div>
                <Button size="sm" variant="outline" tone="surface" onClick={() => setForm({ ...form, tiers: [...form.tiers, emptyTier(nextTierUnit(form))] })}>
                  {t('usagePeriods.editor.addTier')}
                </Button>
              </div>
            )}

            <div className="max-w-xs">
              <FieldGroup label={t('usagePeriods.editor.reminderDays')} hint={t('usagePeriods.editor.reminderHint')}>
                <Input type="number" min={0} max={14} value={form.reminderDaysBefore} onChange={(e) => setForm({ ...form, reminderDaysBefore: Number(e.target.value) })} />
              </FieldGroup>
            </div>

            <div className="grid gap-1">
              <span className="ui-strong">{t('usagePeriods.editor.summary')}</span>
              <p data-testid="usage-rule-preview">{previewText ?? ''}</p>
            </div>

            {ruleIssues.map((issue, i) => (
              <InlineMessage key={i} text={issue.message} tone="error" />
            ))}
            {serverError && <InlineMessage text={serverError} tone="error" />}
            <InlineMessage text={t('usagePeriods.editor.appliesToNew')} />

            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={save}>
                {busy ? t('common.saving') : t('common.save')}
              </Button>
              <Button variant="outline" tone="surface" disabled={busy} onClick={() => setForm(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {!form && rule && <InlineMessage text={t('usagePeriods.editor.appliesToNew')} />}
      </div>
    </section>
  );
}
