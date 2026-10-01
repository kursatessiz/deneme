'use client';

import { useEffect, useState } from 'react';
import { LOYALTY_EXPIRY_MODES, LOYALTY_REWARD_TYPES, LOYALTY_RULE_KINDS } from '@platform/shared';
import type { LoyaltyExpiryMode, LoyaltyRewardDTO, LoyaltyRewardType, LoyaltyRuleDTO, LoyaltyRuleKind, LoyaltySettingsDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch } from '@/lib/session/client';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { Badge, InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField, Toggle } from '@/components/settings/ui';
import { loyaltyErrorMessage, rewardSummary, ruleSummary } from '@/components/loyalty/labels';
import { Select } from '@/components/ui/Select';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { List, ListItem } from '@/components/ui/List';

function SelectField({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <FieldGroup label={label}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </FieldGroup>
  );
}

function ProgramSection({ canManage }: { canManage: boolean }) {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<LoyaltySettingsDTO>(`studios/${activeStudioId}/loyalty/settings`, activeStudioId);
  const [form, setForm] = useState<LoyaltySettingsDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading && !form) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await bffFetch<LoyaltySettingsDTO>(`studios/${activeStudioId}/loyalty/settings`, {
        method: 'PUT',
        studioId: activeStudioId,
        body: {
          enabled: form.enabled,
          expiryMode: form.expiryMode,
          expiryMonths: form.expiryMode === 'MONTHS_AFTER_EARN' ? (form.expiryMonths ?? 12) : null,
          expiryNoticeDays: form.expiryNoticeDays,
          memberRedeemEnabled: form.memberRedeemEnabled,
        },
      });
      setForm(saved);
      setMessage({ text: t('loyalty.program.saved'), tone: 'success' });
    } catch (err) {
      setMessage({ text: loyaltyErrorMessage(err, t), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={t('loyalty.program.title')} description={t('loyalty.program.description')}>
      <div className="space-y-3 max-w-xl">
        <Toggle label={t('loyalty.program.enabled')} checked={form.enabled} disabled={!canManage} onChange={(v) => setForm({ ...form, enabled: v })} />
        <Toggle
          label={t('loyalty.program.memberRedeem')}
          checked={form.memberRedeemEnabled}
          disabled={!canManage}
          onChange={(v) => setForm({ ...form, memberRedeemEnabled: v })}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField
            id="loyalty-expiry-mode"
            label={t('loyalty.program.expiryMode')}
            value={form.expiryMode}
            onChange={(v) =>
              setForm({ ...form, expiryMode: v as LoyaltyExpiryMode, expiryMonths: v === 'MONTHS_AFTER_EARN' ? (form.expiryMonths ?? 12) : null })
            }
          >
            {LOYALTY_EXPIRY_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`loyalty.program.expiryMode.${mode}`)}
              </option>
            ))}
          </SelectField>
          {form.expiryMode === 'MONTHS_AFTER_EARN' && (
            <TextField
              label={t('loyalty.program.expiryMonths')}
              type="number"
              value={String(form.expiryMonths ?? '')}
              onChange={(v) => setForm({ ...form, expiryMonths: Math.max(1, Math.min(120, Number(v) || 1)) })}
            />
          )}
        </div>
        {form.expiryMode === 'MONTHS_AFTER_EARN' && (
          <>
            <TextField
              label={t('loyalty.program.noticeDays')}
              type="number"
              value={String(form.expiryNoticeDays)}
              onChange={(v) => setForm({ ...form, expiryNoticeDays: Math.max(0, Math.min(90, Number(v) || 0)) })}
            />
            <InlineMessage text={t('loyalty.program.expiryHint')} />
          </>
        )}
        {message && <InlineMessage text={message.text} tone={message.tone} />}
        {canManage && (
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </PrimaryButton>
        )}
      </div>
    </Section>
  );
}

function RulesSection({ canManage, currency }: { canManage: boolean; currency: string }) {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useBff<{ items: LoyaltyRuleDTO[] }>(`studios/${activeStudioId}/loyalty/rules`, activeStudioId, refreshKey);
  const [kind, setKind] = useState<LoyaltyRuleKind>('ATTENDANCE');
  const [name, setName] = useState('');
  const [points, setPoints] = useState('10');
  const [perAmount, setPerAmount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const base = `studios/${activeStudioId}/loyalty/rules`;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setRefreshKey((k) => k + 1);
      return true;
    } catch (err) {
      setActionError(loyaltyErrorMessage(err, t));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const ok = await run(() =>
      bffFetch(base, {
        method: 'POST',
        studioId: activeStudioId,
        body: {
          kind,
          name: name.trim() || t(`loyalty.rules.kind.${kind}`),
          points: Number(points) || 0,
          ...(kind === 'PURCHASE_AMOUNT' ? { perAmount: Number(perAmount) || 0, currency } : {}),
        },
      }),
    );
    if (ok) setName('');
  };

  const rules = data?.items ?? [];

  return (
    <Section title={t('loyalty.rules.title')} description={t('loyalty.rules.description')}>
      {loading && !data && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && rules.length === 0 && <InlineMessage text={t('loyalty.rules.empty')} />}
      <List className="ui-divide" data-testid="loyalty-rules">
        {rules.map((rule) => (
          <ListItem key={rule.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="ui-strong">{rule.name}</p>
              <p className="ui-caption">
                {t(`loyalty.rules.kind.${rule.kind}`)} - {ruleSummary(t, rule, locale)}
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-3">
                <Toggle
                  label={t('loyalty.rules.active')}
                  checked={rule.isActive}
                  disabled={busy}
                  onChange={(v) => run(() => bffFetch(`${base}/${rule.id}`, { method: 'PATCH', studioId: activeStudioId, body: { isActive: v } }))}
                />
                <SecondaryButton
                  danger
                  disabled={busy}
                  onClick={() => run(() => bffFetch(`${base}/${rule.id}`, { method: 'DELETE', studioId: activeStudioId }))}
                >
                  {t('loyalty.rules.delete')}
                </SecondaryButton>
              </div>
            )}
          </ListItem>
        ))}
      </List>
      {canManage && (
        <div className="space-y-3 pt-2 max-w-xl">
          <h4 className="ui-caption ui-strong">{t('loyalty.rules.new')}</h4>
          <SelectField id="loyalty-rule-kind" label={t('loyalty.rules.kind')} value={kind} onChange={(v) => setKind(v as LoyaltyRuleKind)}>
            {LOYALTY_RULE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`loyalty.rules.kind.${k}`)}
              </option>
            ))}
          </SelectField>
          <InlineMessage text={t(`loyalty.rules.kindHint.${kind}`)} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <TextField label={t('loyalty.rules.name')} value={name} onChange={setName} placeholder={t(`loyalty.rules.kind.${kind}`)} />
            <TextField label={t('loyalty.rules.points')} type="number" value={points} onChange={setPoints} />
            {kind === 'PURCHASE_AMOUNT' && (
              <TextField label={`${t('loyalty.rules.perAmount')} (${currency})`} type="number" value={perAmount} onChange={setPerAmount} />
            )}
          </div>
          <PrimaryButton onClick={add} disabled={busy}>
            {t('loyalty.rules.add')}
          </PrimaryButton>
        </div>
      )}
      {actionError && <InlineMessage text={actionError} tone="error" />}
    </Section>
  );
}

function RewardsSection({ canManage, currency }: { canManage: boolean; currency: string }) {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useBff<{ items: LoyaltyRewardDTO[] }>(`studios/${activeStudioId}/loyalty/rewards`, activeStudioId, refreshKey);
  const [type, setType] = useState<LoyaltyRewardType>('DISCOUNT_PERCENT');
  const [name, setName] = useState('');
  const [cost, setCost] = useState('100');
  const [value, setValue] = useState('10');
  const [validityDays, setValidityDays] = useState('90');
  const [memberRedeemable, setMemberRedeemable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'neutral' | 'error' } | null>(null);
  const base = `studios/${activeStudioId}/loyalty/rewards`;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setRefreshKey((k) => k + 1);
      return result;
    } catch (err) {
      setMessage({ text: loyaltyErrorMessage(err, t), tone: 'error' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const created = await run(() =>
      bffFetch(base, {
        method: 'POST',
        studioId: activeStudioId,
        body: {
          type,
          name: name.trim() || t(`loyalty.rewards.type.${type}`),
          costPoints: Number(cost) || 0,
          ...(type === 'GIFT' ? {} : { value: Number(value) || 0 }),
          ...(type === 'DISCOUNT_AMOUNT' ? { currency } : {}),
          validityDays: Number(validityDays) || 90,
          memberRedeemable,
        },
      }),
    );
    if (created) setName('');
  };

  const remove = async (reward: LoyaltyRewardDTO) => {
    const result = (await run(() =>
      bffFetch<{ deleted: boolean; deactivated: boolean }>(`${base}/${reward.id}`, { method: 'DELETE', studioId: activeStudioId }),
    )) as {
      deactivated?: boolean;
    } | null;
    if (result?.deactivated) setMessage({ text: t('loyalty.rewards.deactivated'), tone: 'neutral' });
  };

  const rewards = data?.items ?? [];

  return (
    <Section title={t('loyalty.rewards.title')} description={t('loyalty.rewards.description')}>
      {loading && !data && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && rewards.length === 0 && <InlineMessage text={t('loyalty.rewards.empty')} />}
      <List className="ui-divide" data-testid="loyalty-rewards">
        {rewards.map((reward) => (
          <ListItem key={reward.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="ui-strong flex items-center gap-2">
                {reward.name}
                <Badge>{t('loyalty.points', { count: reward.costPoints })}</Badge>
              </p>
              <p className="ui-caption">
                {t(`loyalty.rewards.type.${reward.type}`)} - {rewardSummary(t, reward, locale)}
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-3">
                <Toggle
                  label={t('loyalty.rewards.active')}
                  checked={reward.isActive}
                  disabled={busy}
                  onChange={(v) => run(() => bffFetch(`${base}/${reward.id}`, { method: 'PATCH', studioId: activeStudioId, body: { isActive: v } }))}
                />
                <SecondaryButton danger disabled={busy} onClick={() => remove(reward)}>
                  {t('loyalty.rewards.delete')}
                </SecondaryButton>
              </div>
            )}
          </ListItem>
        ))}
      </List>
      {canManage && (
        <div className="space-y-3 pt-2 max-w-xl">
          <h4 className="ui-caption ui-strong">{t('loyalty.rewards.new')}</h4>
          <SelectField id="loyalty-reward-type" label={t('loyalty.rewards.type')} value={type} onChange={(v) => setType(v as LoyaltyRewardType)}>
            {LOYALTY_REWARD_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`loyalty.rewards.type.${k}`)}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <TextField label={t('loyalty.rewards.name')} value={name} onChange={setName} placeholder={t(`loyalty.rewards.type.${type}`)} />
            <TextField label={t('loyalty.rewards.cost')} type="number" value={cost} onChange={setCost} />
            {type !== 'GIFT' && (
              <TextField
                label={type === 'DISCOUNT_AMOUNT' ? `${t('loyalty.rewards.value.DISCOUNT_AMOUNT')} (${currency})` : t(`loyalty.rewards.value.${type}`)}
                type="number"
                value={value}
                onChange={setValue}
              />
            )}
          </div>
          {(type === 'DISCOUNT_AMOUNT' || type === 'DISCOUNT_PERCENT') && (
            <TextField label={t('loyalty.rewards.validityDays')} type="number" value={validityDays} onChange={setValidityDays} />
          )}
          <Toggle label={t('loyalty.rewards.memberRedeemable')} checked={memberRedeemable} onChange={setMemberRedeemable} />
          <PrimaryButton onClick={add} disabled={busy}>
            {t('loyalty.rewards.add')}
          </PrimaryButton>
        </div>
      )}
      {message && <InlineMessage text={message.text} tone={message.tone} />}
    </Section>
  );
}

function LoyaltySettingsView() {
  const t = useT();
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canManage = hasAnyPermission(['loyalty.manage'], permissions, isOwner);
  const { data, forbidden } = useBff<LoyaltySettingsDTO>(`studios/${activeStudioId}/loyalty/settings`, activeStudioId);
  if (forbidden) return <ErrorState message={t('loyalty.forbidden')} />;
  const currency = data?.currency ?? '';

  return (
    <div className="space-y-6">
      <SettingsHeader title={t('loyalty.title')} description={t('loyalty.subtitle')} />
      <ProgramSection canManage={canManage} />
      {currency && <RulesSection canManage={canManage} currency={currency} />}
      {currency && <RewardsSection canManage={canManage} currency={currency} />}
    </div>
  );
}

export default function LoyaltySettingsPage() {
  return (
    <PageGuard required={['loyalty.view', 'loyalty.manage']}>
      <LoyaltySettingsView />
    </PageGuard>
  );
}
