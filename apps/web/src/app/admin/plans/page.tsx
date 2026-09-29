'use client';

import { useState } from 'react';
import { PLATFORM_BILLING_CURRENCIES } from '@platform/shared';
import type { AdminPlanDTO, PlatformBillingCurrency } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { formatMoney } from '@/lib/money';

type Plan = AdminPlanDTO;
type PriceForm = Record<PlatformBillingCurrency, string>;
const emptyPrices = (): PriceForm => Object.fromEntries(PLATFORM_BILLING_CURRENCIES.map((c) => [c, ''])) as PriceForm;

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export default function PlansPage() {
  const locale = useLocale();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: Plan[] }>('admin/plans', null, refreshKey);
  const t = useT();
  const emptyForm = { key: '', name: '', trialDays: '', maxBranches: '', maxActiveMembers: '', maxStaff: '', aiBudget: '' };
  const [form, setForm] = useState(emptyForm);
  const [prices, setPrices] = useState<PriceForm>(emptyPrices);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // One price per billing currency; an empty input means "not offered" in it.
    const priceList = PLATFORM_BILLING_CURRENCIES.filter((c) => prices[c].trim() !== '').map((c) => ({ currency: c, priceMonthly: Number(prices[c]) }));
    if (priceList.length === 0) {
      setFormError(t('adminPlans.form.priceRequired'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await bffFetch('admin/plans', {
        method: 'POST',
        body: {
          key: form.key,
          name: form.name,
          prices: priceList,
          ...(form.trialDays !== '' ? { trialDays: Number(form.trialDays) } : {}),
          limits: {
            ...(form.maxBranches ? { maxBranches: Number(form.maxBranches) } : {}),
            ...(form.maxActiveMembers ? { maxActiveMembers: Number(form.maxActiveMembers) } : {}),
            ...(form.maxStaff ? { maxStaff: Number(form.maxStaff) } : {}),
            ...(form.aiBudget !== '' ? { aiMonthlyBudgetCents: Math.round(Number(form.aiBudget) * 100) } : {}),
          },
          isActive: true,
        },
      });
      setForm(emptyForm);
      setPrices(emptyPrices());
      refresh();
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : t('adminPlans.form.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (plan: Plan) => {
    await bffFetch(`admin/plans/${plan.key}/${plan.isActive ? 'deactivate' : 'activate'}`, { method: 'POST' });
    refresh();
  };

  if (forbidden) return <EmptyState title={t('adminPlans.accessDenied')} />;

  return (
    <div className="space-y-6" key={refreshKey}>
      <div>
        <h2 className="text-xl font-bold">{t('adminPlans.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminPlans.subtitle')}
        </p>
      </div>

      <form onSubmit={submit} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <h3 className="text-sm font-semibold">{t('adminPlans.form.title')}</h3>
        <div className="grid grid-cols-3 gap-3">
          <input required placeholder={t('adminPlans.form.key')} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input required placeholder={t('adminPlans.form.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          {PLATFORM_BILLING_CURRENCIES.map((currency) => (
            <input
              key={currency}
              type="number"
              min={0}
              step="0.01"
              placeholder={t('adminPlans.form.priceIn', { currency })}
              aria-label={t('adminPlans.form.priceIn', { currency })}
              value={prices[currency]}
              onChange={(e) => setPrices({ ...prices, [currency]: e.target.value })}
              className="border px-3 py-2 text-sm"
              style={inputStyle}
            />
          ))}
          <input type="number" min={0} max={365} placeholder={t('adminPlans.form.trialDays')} aria-label={t('adminPlans.form.trialDays')} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input type="number" placeholder={t('adminPlans.form.maxBranches')} value={form.maxBranches} onChange={(e) => setForm({ ...form, maxBranches: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input type="number" placeholder={t('adminPlans.form.maxActiveMembers')} value={form.maxActiveMembers} onChange={(e) => setForm({ ...form, maxActiveMembers: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input type="number" placeholder={t('adminPlans.form.maxStaff')} value={form.maxStaff} onChange={(e) => setForm({ ...form, maxStaff: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder={t('adminAi.plan.budget')}
            aria-label={t('adminAi.plan.budget')}
            value={form.aiBudget}
            onChange={(e) => setForm({ ...form, aiBudget: e.target.value })}
            className="border px-3 py-2 text-sm"
            style={inputStyle}
          />
        </div>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('adminPlans.form.pricesHint')}
        </p>
        {formError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{formError}</p>}
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {submitting ? t('adminPlans.form.submitting') : t('adminPlans.form.submit')}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((p) => (
            <div key={p.id} className="p-5 border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="flex items-start justify-between">
                <h3 className="text-sm font-semibold">{p.name}</h3>
                <span
                  className="px-2 py-0.5 text-xs font-medium"
                  style={{ borderRadius: 'var(--radius-chip)', backgroundColor: p.isActive ? 'var(--color-surface-muted)' : 'var(--color-danger)', color: p.isActive ? 'var(--color-text-secondary)' : 'var(--color-on-primary)' }}
                >
                  {p.isActive ? t('adminPlans.status.active') : t('adminPlans.status.inactive')}
                </span>
              </div>
              <p className="text-xs mt-1 font-mono" style={{ color: 'var(--color-text-muted)' }}>
                {p.key}
              </p>
              <ul className="text-xs mt-1 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                {PLATFORM_BILLING_CURRENCIES.map((currency) => {
                  const price = p.prices.find((x) => x.currency === currency);
                  return (
                    <li key={currency}>
                      {price ? t('adminPlans.priceLine', { price: formatMoney(price.priceMonthly, currency, locale) }) : t('adminPlans.noPrice', { currency })}
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('adminPlans.trialSummary', { days: p.trialDays })}
              </p>
              <ul className="text-xs mt-3 space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
                <li>{t('adminPlans.limits.branches', { value: p.limits.maxBranches ?? t('adminPlans.limits.unlimited') })}</li>
                <li>{t('adminPlans.limits.members', { value: p.limits.maxActiveMembers ?? t('adminPlans.limits.unlimited') })}</li>
                <li>{t('adminPlans.limits.staff', { value: p.limits.maxStaff ?? t('adminPlans.limits.unlimited') })}</li>
                <li>
                  {p.limits.aiMonthlyBudgetCents !== undefined
                    ? t('adminAi.plan.budgetValue', {
                        amount: new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(p.limits.aiMonthlyBudgetCents / 100),
                      })
                    : t('adminAi.plan.budgetDefault')}
                </li>
              </ul>
              <button onClick={() => toggleActive(p)} className="text-xs font-medium underline mt-3" style={{ color: 'var(--color-text-secondary)' }}>
                {p.isActive ? t('adminPlans.deactivate') : t('adminPlans.activate')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
