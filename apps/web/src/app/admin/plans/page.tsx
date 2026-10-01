'use client';

import { useState } from 'react';
import { PLATFORM_BILLING_CURRENCIES } from '@platform/shared';
import type { AdminPlanDTO, PlatformBillingCurrency } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { formatMoney } from '@/lib/money';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';

type Plan = AdminPlanDTO;
type PriceForm = Record<PlatformBillingCurrency, string>;
const emptyPrices = (): PriceForm => Object.fromEntries(PLATFORM_BILLING_CURRENCIES.map((c) => [c, ''])) as PriceForm;

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
    <div className="grid gap-6" key={refreshKey}>
      <PageHeader title={t('adminPlans.title')} description={t('adminPlans.subtitle')} />

      <Card as="section">
        <form onSubmit={submit} className="pui-card-content">
          <h3 className="ui-heading">{t('adminPlans.form.title')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input required placeholder={t('adminPlans.form.key')} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            <Input required placeholder={t('adminPlans.form.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            {PLATFORM_BILLING_CURRENCIES.map((currency) => (
              <Input
                key={currency}
                type="number"
                min={0}
                step="0.01"
                placeholder={t('adminPlans.form.priceIn', { currency })}
                aria-label={t('adminPlans.form.priceIn', { currency })}
                value={prices[currency]}
                onChange={(e) => setPrices({ ...prices, [currency]: e.target.value })}
              />
            ))}
            <Input type="number" min={0} max={365} placeholder={t('adminPlans.form.trialDays')} aria-label={t('adminPlans.form.trialDays')} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} />
            <Input type="number" placeholder={t('adminPlans.form.maxBranches')} value={form.maxBranches} onChange={(e) => setForm({ ...form, maxBranches: e.target.value })} />
            <Input type="number" placeholder={t('adminPlans.form.maxActiveMembers')} value={form.maxActiveMembers} onChange={(e) => setForm({ ...form, maxActiveMembers: e.target.value })} />
            <Input type="number" placeholder={t('adminPlans.form.maxStaff')} value={form.maxStaff} onChange={(e) => setForm({ ...form, maxStaff: e.target.value })} />
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder={t('adminAi.plan.budget')}
              aria-label={t('adminAi.plan.budget')}
              value={form.aiBudget}
              onChange={(e) => setForm({ ...form, aiBudget: e.target.value })}
            />
          </div>
          <p className="ui-caption">{t('adminPlans.form.pricesHint')}</p>
          {formError && <p className="ui-caption ui-text-error">{formError}</p>}
          <Button type="submit" disabled={submitting} className="justify-self-start">
            {submitting ? t('adminPlans.form.submitting') : t('adminPlans.form.submit')}
          </Button>
        </form>
      </Card>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((p) => (
            <Card key={p.id}>
              <CardContent>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="ui-heading">{p.name}</h3>
                  <Badge variant={p.isActive ? 'soft' : 'solid'} tone={p.isActive ? 'muted' : 'error'}>
                    {p.isActive ? t('adminPlans.status.active') : t('adminPlans.status.inactive')}
                  </Badge>
                </div>
                <p className="ui-caption ui-mono">{p.key}</p>
                <ul className="ui-small grid gap-0.5">
                  {PLATFORM_BILLING_CURRENCIES.map((currency) => {
                    const price = p.prices.find((x) => x.currency === currency);
                    return (
                      <li key={currency}>
                        {price ? t('adminPlans.priceLine', { price: formatMoney(price.priceMonthly, currency, locale) }) : t('adminPlans.noPrice', { currency })}
                      </li>
                    );
                  })}
                </ul>
                <p className="ui-caption">{t('adminPlans.trialSummary', { days: p.trialDays })}</p>
                <ul className="ui-small grid gap-1">
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
                <Button variant="link" tone="surface" size="sm" className="justify-self-start" onClick={() => toggleActive(p)}>
                  {p.isActive ? t('adminPlans.deactivate') : t('adminPlans.activate')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
