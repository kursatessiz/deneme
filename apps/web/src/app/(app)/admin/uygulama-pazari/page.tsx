'use client';

import { useState } from 'react';
import { PLATFORM_BILLING_CURRENCIES, localizedText } from '@platform/shared';
import type { AdminAddOnDTO, AdminAddOnRevenueDTO, PlatformBillingCurrency } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { formatMoney } from '@/lib/money';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Textarea } from '@/components/ui/Textarea';

const EDIT_LOCALES = ['tr', 'en'] as const;
type EditLocale = (typeof EDIT_LOCALES)[number];

interface FormState {
  key: string;
  name: Record<EditLocale, string>;
  description: Record<EditLocale, string>;
  promoVideoUrl: string;
  screenshotUrls: string;
  featureFlagKey: string;
  trialDays: string;
  sortOrder: string;
}

type PriceForm = Record<PlatformBillingCurrency, { monthly: string; yearly: string }>;

const emptyForm = (): FormState => ({
  key: '',
  name: { tr: '', en: '' },
  description: { tr: '', en: '' },
  promoVideoUrl: '',
  screenshotUrls: '',
  featureFlagKey: '',
  trialDays: '14',
  sortOrder: '0',
});

const emptyPrices = (): PriceForm => Object.fromEntries(PLATFORM_BILLING_CURRENCIES.map((c) => [c, { monthly: '', yearly: '' }])) as PriceForm;

function toForm(addOn: AdminAddOnDTO): FormState {
  return {
    key: addOn.key,
    name: { tr: addOn.name.tr ?? '', en: addOn.name.en ?? '' },
    description: { tr: addOn.description.tr ?? '', en: addOn.description.en ?? '' },
    promoVideoUrl: addOn.promoVideoUrl ?? '',
    screenshotUrls: addOn.screenshotUrls.join('\n'),
    featureFlagKey: addOn.featureFlagKey,
    trialDays: String(addOn.trialDays),
    sortOrder: String(addOn.sortOrder),
  };
}

function toPriceForm(addOn: AdminAddOnDTO): PriceForm {
  const form = emptyPrices();
  for (const price of addOn.prices) form[price.currency] = { monthly: price.priceMonthly, yearly: price.priceYearly };
  return form;
}

/** Super admin: the add-on marketplace catalogue (G5c-2). */
export default function AddOnMarketplacePage() {
  const t = useT();
  const locale = useLocale();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: AdminAddOnDTO[] }>('admin/add-ons', null, refreshKey);
  const revenue = useBff<AdminAddOnRevenueDTO>('admin/add-ons/revenue', null, refreshKey);
  const [editing, setEditing] = useState<AdminAddOnDTO | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [prices, setPrices] = useState<PriceForm>(emptyPrices);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const open = (target: AdminAddOnDTO | 'new') => {
    setEditing(target);
    setForm(target === 'new' ? emptyForm() : toForm(target));
    setPrices(target === 'new' ? emptyPrices() : toPriceForm(target));
    setFormError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceList: { currency: PlatformBillingCurrency; priceMonthly: number; priceYearly: number }[] = [];
    for (const currency of PLATFORM_BILLING_CURRENCIES) {
      const { monthly, yearly } = prices[currency];
      if (monthly.trim() === '' && yearly.trim() === '') continue;
      if (monthly.trim() === '' || yearly.trim() === '') {
        setFormError(t('adminAddOns.prices.incomplete', { currency }));
        return;
      }
      priceList.push({ currency, priceMonthly: Number(monthly), priceYearly: Number(yearly) });
    }
    setBusy(true);
    setFormError(null);
    try {
      const fields = {
        name: form.name,
        description: form.description,
        promoVideoUrl: form.promoVideoUrl.trim() === '' ? null : form.promoVideoUrl.trim(),
        screenshotUrls: form.screenshotUrls.split('\n').map((l) => l.trim()).filter((l) => l !== ''),
        featureFlagKey: form.featureFlagKey.trim(),
        trialDays: Number(form.trialDays),
        sortOrder: Number(form.sortOrder),
      };
      const saved =
        editing === 'new'
          ? await bffFetch<AdminAddOnDTO>('admin/add-ons', { method: 'POST', body: { key: form.key.trim(), ...fields } })
          : await bffFetch<AdminAddOnDTO>(`admin/add-ons/${(editing as AdminAddOnDTO).id}`, { method: 'PATCH', body: fields });
      await bffFetch<AdminAddOnDTO>(`admin/add-ons/${saved.id}/prices`, { method: 'PUT', body: { prices: priceList } });
      setEditing(null);
      refresh();
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : t('adminAddOns.form.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async (addOn: AdminAddOnDTO) => {
    try {
      await bffFetch(`admin/add-ons/${addOn.id}`, { method: 'PATCH', body: { isPublished: !addOn.isPublished } });
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : t('adminAddOns.form.saveFailed'));
    }
    refresh();
  };

  if (forbidden) return <EmptyState title={t('adminAddOns.accessDenied')} />;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('adminAddOns.title')}
        description={t('adminAddOns.subtitle')}
        actions={<Button onClick={() => open('new')}>{t('adminAddOns.new')}</Button>}
      />

      {editing && (
        <form onSubmit={save} className="pui-card" aria-label={editing === 'new' ? t('adminAddOns.form.createTitle') : t('adminAddOns.form.editTitle')}>
          <div className="pui-card-content">
            <h3 className="ui-heading">{editing === 'new' ? t('adminAddOns.form.createTitle') : t('adminAddOns.form.editTitle')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FieldGroup label={t('adminAddOns.form.key')} hint={t('adminAddOns.form.keyHint')}>
                <Input required disabled={editing !== 'new'} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="ui-mono" />
              </FieldGroup>
              <FieldGroup label={t('adminAddOns.form.featureFlagKey')} hint={t('adminAddOns.form.featureFlagHint')}>
                <Input required value={form.featureFlagKey} onChange={(e) => setForm({ ...form, featureFlagKey: e.target.value })} className="ui-mono" />
              </FieldGroup>
              {EDIT_LOCALES.map((l) => (
                <FieldGroup key={`name-${l}`} label={t('adminAddOns.form.nameIn', { locale: l })}>
                  <Input required value={form.name[l]} onChange={(e) => setForm({ ...form, name: { ...form.name, [l]: e.target.value } })} />
                </FieldGroup>
              ))}
              {EDIT_LOCALES.map((l) => (
                <FieldGroup key={`desc-${l}`} label={t('adminAddOns.form.descriptionIn', { locale: l })}>
                  <Textarea required rows={3} value={form.description[l]} onChange={(e) => setForm({ ...form, description: { ...form.description, [l]: e.target.value } })} />
                </FieldGroup>
              ))}
              <FieldGroup label={t('adminAddOns.form.promoVideoUrl')}>
                <Input type="url" value={form.promoVideoUrl} onChange={(e) => setForm({ ...form, promoVideoUrl: e.target.value })} />
              </FieldGroup>
              <FieldGroup label={t('adminAddOns.form.screenshotUrls')}>
                <Textarea rows={3} value={form.screenshotUrls} onChange={(e) => setForm({ ...form, screenshotUrls: e.target.value })} />
              </FieldGroup>
              <FieldGroup label={t('adminAddOns.form.trialDays')}>
                <Input type="number" min={0} max={90} required value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} />
              </FieldGroup>
              <FieldGroup label={t('adminAddOns.form.sortOrder')}>
                <Input type="number" min={0} required value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
              </FieldGroup>
            </div>

            <fieldset className="grid gap-2">
              <legend className="ui-heading">{t('adminAddOns.prices.title')}</legend>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {PLATFORM_BILLING_CURRENCIES.map((currency) => (
                  <div key={currency} className="grid gap-1">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label={t('adminAddOns.prices.monthlyIn', { currency })}
                      placeholder={t('adminAddOns.prices.monthlyIn', { currency })}
                      value={prices[currency].monthly}
                      onChange={(e) => setPrices({ ...prices, [currency]: { ...prices[currency], monthly: e.target.value } })}
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label={t('adminAddOns.prices.yearlyIn', { currency })}
                      placeholder={t('adminAddOns.prices.yearlyIn', { currency })}
                      value={prices[currency].yearly}
                      onChange={(e) => setPrices({ ...prices, [currency]: { ...prices[currency], yearly: e.target.value } })}
                    />
                  </div>
                ))}
              </div>
              <p className="ui-caption">{t('adminAddOns.prices.hint')}</p>
            </fieldset>

            {formError && (
              <p role="alert" className="ui-caption ui-text-error">
                {formError}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? t('adminAddOns.form.saving') : t('adminAddOns.form.save')}
              </Button>
              <Button variant="outline" tone="surface" onClick={() => setEditing(null)}>
                {t('adminAddOns.form.cancel')}
              </Button>
            </div>
          </div>
        </form>
      )}

      {loading && !data && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && <EmptyState title={t('adminAddOns.empty.title')} description={t('adminAddOns.empty.description')} />}
      {data && data.items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((a) => (
            <Card key={a.id} data-testid={`admin-add-on-${a.key}`}>
              <CardContent>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="ui-heading">{localizedText(a.name, locale)}</h3>
                  <Badge tone={a.isPublished ? 'success' : 'muted'}>{a.isPublished ? t('adminAddOns.status.published') : t('adminAddOns.status.draft')}</Badge>
                </div>
                <p className="ui-caption ui-mono">{a.key}</p>
                <p className="ui-small">{t('adminAddOns.flagLine', { flag: a.featureFlagKey })}</p>
                <p className="ui-small">{t('adminAddOns.trialLine', { count: a.trialDays })}</p>
                <ul className="ui-small grid gap-0.5">
                  {PLATFORM_BILLING_CURRENCIES.map((currency) => {
                    const price = a.prices.find((p) => p.currency === currency);
                    return (
                      <li key={currency}>
                        {price
                          ? t('adminAddOns.price.line', { monthly: formatMoney(price.priceMonthly, currency, locale), yearly: formatMoney(price.priceYearly, currency, locale) })
                          : t('adminAddOns.price.none', { currency })}
                      </li>
                    );
                  })}
                </ul>
                <p className="ui-small ui-strong">{t('adminAddOns.tenantCount', { count: a.tenantCount })}</p>
                <div className="flex gap-3">
                  <Button variant="link" tone="surface" size="sm" onClick={() => open(a)}>
                    {t('adminAddOns.edit')}
                  </Button>
                  <Button variant="link" tone="surface" size="sm" onClick={() => togglePublish(a)}>
                    {a.isPublished ? t('adminAddOns.unpublish') : t('adminAddOns.publish')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card as="section" aria-labelledby="add-on-revenue">
        <CardContent>
          <h3 id="add-on-revenue" className="ui-heading">
            {t('adminAddOns.revenue.title')}
          </h3>
          <p className="ui-caption">{t('adminAddOns.revenue.hint')}</p>
          {revenue.data && revenue.data.items.length === 0 && <p>{t('adminAddOns.revenue.empty')}</p>}
          <ul className="grid gap-1">
            {(revenue.data?.items ?? []).map((r) => (
              <li key={r.currency}>{t('adminAddOns.revenue.line', { amount: formatMoney(r.amount, r.currency, locale), count: r.payments })}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
