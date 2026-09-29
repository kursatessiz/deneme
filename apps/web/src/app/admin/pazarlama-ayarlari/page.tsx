'use client';

import { useCallback, useEffect, useState } from 'react';
import { MoneyAmountSchema, CurrencyCodeSchema, type MarketingSettingsViewDTO, type UpdateMarketingSettingsInput } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader } from '@/components/settings/ui';
import { CheckField, InputField, LinkButton } from '@/components/marketing/fields';
import { bffFetch, BffError } from '@/lib/session/client';

interface Form {
  selfApproveEmailMax: string;
  selfApproveSmsMax: string;
  selfApproveSmsCredits: string;
  approvalTtlHours: string;
  requireApprovalForSocial: boolean;
  dailyEmailCap: string;
  dailySmsCreditCap: string;
  aiDailyCapCents: string;
  bounceAutoPausePct: string;
  complaintAutoPausePct: string;
  adSpend: Array<{ currency: string; amount: string }>;
  weeklySummaryEnabled: boolean;
  weeklySummaryRecipients: string[];
}

function formOf(view: MarketingSettingsViewDTO): Form {
  const s = view.settings;
  const opt = (n: number | null) => (n === null ? '' : String(n));
  return {
    selfApproveEmailMax: String(s.selfApproveEmailMax),
    selfApproveSmsMax: String(s.selfApproveSmsMax),
    selfApproveSmsCredits: String(s.selfApproveSmsCredits),
    approvalTtlHours: String(s.approvalTtlHours),
    requireApprovalForSocial: s.requireApprovalForSocial,
    dailyEmailCap: opt(s.dailyEmailCap),
    dailySmsCreditCap: opt(s.dailySmsCreditCap),
    aiDailyCapCents: opt(s.aiDailyCapCents),
    bounceAutoPausePct: String(s.bounceAutoPausePct),
    complaintAutoPausePct: String(s.complaintAutoPausePct),
    adSpend: Object.entries(s.monthlyAdSpendCaps).map(([currency, amount]) => ({ currency, amount })),
    weeklySummaryEnabled: s.weeklySummaryEnabled,
    weeklySummaryRecipients: s.weeklySummaryRecipients,
  };
}

const int = (v: string): number | null => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
const optionalInt = (v: string): number | null | undefined => (v.trim() === '' ? null : (int(v) ?? undefined));
const decimal = (v: string): number | null => (/^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : null);

/** The PATCH body, or null when a field is invalid (the API validates the same rules with the shared schema). */
function toInput(form: Form): UpdateMarketingSettingsInput | null {
  const required = [form.selfApproveEmailMax, form.selfApproveSmsMax, form.selfApproveSmsCredits, form.approvalTtlHours].map(int);
  const optional = [form.dailyEmailCap, form.dailySmsCreditCap, form.aiDailyCapCents].map(optionalInt);
  const pct = [form.bounceAutoPausePct, form.complaintAutoPausePct].map(decimal);
  if (required.some((v) => v === null) || optional.some((v) => v === undefined) || pct.some((v) => v === null || v > 100)) return null;
  const caps: Record<string, string> = {};
  for (const row of form.adSpend) {
    const currency = row.currency.trim().toUpperCase();
    if (!CurrencyCodeSchema.safeParse(currency).success || !MoneyAmountSchema.safeParse(row.amount).success) return null;
    caps[currency] = row.amount.trim();
  }
  return {
    selfApproveEmailMax: required[0]!,
    selfApproveSmsMax: required[1]!,
    selfApproveSmsCredits: required[2]!,
    approvalTtlHours: required[3]!,
    requireApprovalForSocial: form.requireApprovalForSocial,
    dailyEmailCap: optional[0] ?? null,
    dailySmsCreditCap: optional[1] ?? null,
    aiDailyCapCents: optional[2] ?? null,
    bounceAutoPausePct: pct[0]!,
    complaintAutoPausePct: pct[1]!,
    monthlyAdSpendCaps: caps,
    weeklySummaryEnabled: form.weeklySummaryEnabled,
    weeklySummaryRecipients: form.weeklySummaryRecipients,
  };
}

/**
 * Super admin marketing settings (M3b, docs/SUPER_ADMIN.md): self-approval
 * thresholds and request TTL (in force now), daily caps, the monthly ad
 * spend cap per currency, auto-pause rates and the weekly summary (stored
 * for M3d). Same pattern as /admin/ai: one GET, one PATCH, audit logged by
 * the API.
 */
export default function AdminMarketingSettingsPage() {
  const t = useT();
  const locale = useLocale();
  const [view, setView] = useState<MarketingSettingsViewDTO | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await bffFetch<MarketingSettingsViewDTO>('admin/marketing/settings');
      setView(next);
      setForm(formOf(next));
    } catch {
      setError(t('adminMarketingSettings.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} />;
  if (!view || !form) return <LoadingState />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const adSpendInvalid = form.adSpend.some((r) => !CurrencyCodeSchema.safeParse(r.currency.trim().toUpperCase()).success || !MoneyAmountSchema.safeParse(r.amount).success);

  async function save() {
    if (!form) return;
    const body = toInput(form);
    if (!body) {
      setMessage({ tone: 'error', text: t('adminMarketingSettings.invalid') });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const next = await bffFetch<MarketingSettingsViewDTO>('admin/marketing/settings', { method: 'PATCH', body });
      setView(next);
      setForm(formOf(next));
      setMessage({ tone: 'success', text: t('adminMarketingSettings.saved') });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof BffError && err.message ? err.message : t('adminMarketingSettings.invalid') });
    } finally {
      setBusy(false);
    }
  }

  const updatedAt = view.settings.updatedAt;
  return (
    <div className="space-y-5 max-w-3xl">
      <SettingsHeader title={t('adminMarketingSettings.title')} description={t('adminMarketingSettings.subtitle')} />
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {updatedAt
          ? t('adminMarketingSettings.updatedAt', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(updatedAt)) })
          : t('adminMarketingSettings.defaults')}
      </p>

      <Section title={t('adminMarketingSettings.approval.title')} description={t('adminMarketingSettings.approval.description')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <InputField type="number" label={t('adminMarketingSettings.field.selfApproveEmailMax')} value={form.selfApproveEmailMax} onChange={(v) => set('selfApproveEmailMax', v)} invalid={int(form.selfApproveEmailMax) === null} />
          <InputField type="number" label={t('adminMarketingSettings.field.selfApproveSmsMax')} value={form.selfApproveSmsMax} onChange={(v) => set('selfApproveSmsMax', v)} invalid={int(form.selfApproveSmsMax) === null} />
          <InputField type="number" label={t('adminMarketingSettings.field.selfApproveSmsCredits')} value={form.selfApproveSmsCredits} onChange={(v) => set('selfApproveSmsCredits', v)} invalid={int(form.selfApproveSmsCredits) === null} />
          <InputField type="number" label={t('adminMarketingSettings.field.approvalTtlHours')} value={form.approvalTtlHours} onChange={(v) => set('approvalTtlHours', v)} invalid={int(form.approvalTtlHours) === null} />
        </div>
        <CheckField label={t('adminMarketingSettings.field.requireApprovalForSocial')} checked={form.requireApprovalForSocial} onChange={(v) => set('requireApprovalForSocial', v)} />
      </Section>

      <Section title={t('adminMarketingSettings.caps.title')} description={t('adminMarketingSettings.caps.description')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <InputField type="number" label={t('adminMarketingSettings.field.dailyEmailCap')} hint={t('adminMarketingSettings.noLimit')} value={form.dailyEmailCap} onChange={(v) => set('dailyEmailCap', v)} invalid={optionalInt(form.dailyEmailCap) === undefined} />
          <InputField type="number" label={t('adminMarketingSettings.field.dailySmsCreditCap')} value={form.dailySmsCreditCap} onChange={(v) => set('dailySmsCreditCap', v)} invalid={optionalInt(form.dailySmsCreditCap) === undefined} />
          <InputField type="number" label={t('adminMarketingSettings.field.aiDailyCapCents')} value={form.aiDailyCapCents} onChange={(v) => set('aiDailyCapCents', v)} invalid={optionalInt(form.aiDailyCapCents) === undefined} />
        </div>
      </Section>

      <Section title={t('adminMarketingSettings.adSpend.title')} description={t('adminMarketingSettings.adSpend.description')}>
        {form.adSpend.length === 0 && <InlineMessage text={t('adminMarketingSettings.adSpend.empty')} />}
        {form.adSpend.map((row, i) => (
          <div key={i} className="grid grid-cols-[8rem_1fr_auto] items-end gap-3">
            <InputField
              label={t('adminMarketingSettings.adSpend.currency')}
              value={row.currency}
              onChange={(v) => set('adSpend', form.adSpend.map((r, j) => (j === i ? { ...r, currency: v.toUpperCase().slice(0, 3) } : r)))}
            />
            <InputField
              label={t('adminMarketingSettings.adSpend.amount')}
              value={row.amount}
              onChange={(v) => set('adSpend', form.adSpend.map((r, j) => (j === i ? { ...r, amount: v } : r)))}
            />
            <div className="pb-2">
              <LinkButton danger onClick={() => set('adSpend', form.adSpend.filter((_, j) => j !== i))}>
                {t('adminMarketingSettings.adSpend.remove')}
              </LinkButton>
            </div>
          </div>
        ))}
        {adSpendInvalid && <InlineMessage tone="error" text={t('adminMarketingSettings.adSpend.invalid')} />}
        <SecondaryButton onClick={() => set('adSpend', [...form.adSpend, { currency: '', amount: '' }])}>{t('adminMarketingSettings.adSpend.add')}</SecondaryButton>
      </Section>

      <Section title={t('adminMarketingSettings.autoPause.title')} description={t('adminMarketingSettings.autoPause.description')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <InputField label={t('adminMarketingSettings.field.bounceAutoPausePct')} value={form.bounceAutoPausePct} onChange={(v) => set('bounceAutoPausePct', v)} invalid={decimal(form.bounceAutoPausePct) === null} />
          <InputField label={t('adminMarketingSettings.field.complaintAutoPausePct')} value={form.complaintAutoPausePct} onChange={(v) => set('complaintAutoPausePct', v)} invalid={decimal(form.complaintAutoPausePct) === null} />
        </div>
      </Section>

      <Section title={t('adminMarketingSettings.weekly.title')} description={t('adminMarketingSettings.weekly.description')}>
        <CheckField label={t('adminMarketingSettings.field.weeklySummaryEnabled')} checked={form.weeklySummaryEnabled} onChange={(v) => set('weeklySummaryEnabled', v)} />
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminMarketingSettings.weekly.recipients')}
          </legend>
          {view.recipients.length === 0 && <InlineMessage text={t('adminMarketingSettings.weekly.noRecipients')} />}
          {view.recipients.map((r) => (
            <CheckField
              key={r.userId}
              label={r.isSuperAdmin ? `${r.name} (${t('adminMarketingSettings.weekly.superAdmin')})` : r.name}
              checked={form.weeklySummaryRecipients.includes(r.userId)}
              onChange={(on) =>
                set('weeklySummaryRecipients', on ? [...form.weeklySummaryRecipients, r.userId] : form.weeklySummaryRecipients.filter((id) => id !== r.userId))
              }
            />
          ))}
        </fieldset>
      </Section>

      <div className="flex items-center gap-3">
        <PrimaryButton onClick={save} disabled={busy}>
          {t('adminMarketingSettings.save')}
        </PrimaryButton>
        {message && <InlineMessage tone={message.tone} text={message.text} />}
      </div>
    </div>
  );
}
