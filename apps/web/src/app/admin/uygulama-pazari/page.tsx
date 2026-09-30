'use client';

import { useState } from 'react';
import { PLATFORM_BILLING_CURRENCIES, localizedText } from '@platform/shared';
import type { AdminAddOnDTO, AdminAddOnRevenueDTO, PlatformBillingCurrency } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { formatMoney } from '@/lib/money';

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

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};
const surface: React.CSSProperties = { borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' };
const primaryButton: React.CSSProperties = { borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' };

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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">{t('adminAddOns.title')}</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminAddOns.subtitle')}
          </p>
        </div>
        <button type="button" onClick={() => open('new')} className="px-4 py-2 text-sm font-medium shrink-0" style={primaryButton}>
          {t('adminAddOns.new')}
        </button>
      </div>

      {editing && (
        <form onSubmit={save} className="p-5 border space-y-3" style={surface} aria-label={editing === 'new' ? t('adminAddOns.form.createTitle') : t('adminAddOns.form.editTitle')}>
          <h3 className="text-sm font-semibold">{editing === 'new' ? t('adminAddOns.form.createTitle') : t('adminAddOns.form.editTitle')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs space-y-1">
              <span>{t('adminAddOns.form.key')}</span>
              <input required disabled={editing !== 'new'} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="border px-3 py-2 text-sm w-full font-mono" style={inputStyle} />
              <span className="block" style={{ color: 'var(--color-text-muted)' }}>{t('adminAddOns.form.keyHint')}</span>
            </label>
            <label className="text-xs space-y-1">
              <span>{t('adminAddOns.form.featureFlagKey')}</span>
              <input required value={form.featureFlagKey} onChange={(e) => setForm({ ...form, featureFlagKey: e.target.value })} className="border px-3 py-2 text-sm w-full font-mono" style={inputStyle} />
              <span className="block" style={{ color: 'var(--color-text-muted)' }}>{t('adminAddOns.form.featureFlagHint')}</span>
            </label>
            {EDIT_LOCALES.map((l) => (
              <label key={`name-${l}`} className="text-xs space-y-1">
                <span>{t('adminAddOns.form.nameIn', { locale: l })}</span>
                <input required value={form.name[l]} onChange={(e) => setForm({ ...form, name: { ...form.name, [l]: e.target.value } })} className="border px-3 py-2 text-sm w-full" style={inputStyle} />
              </label>
            ))}
            {EDIT_LOCALES.map((l) => (
              <label key={`desc-${l}`} className="text-xs space-y-1">
                <span>{t('adminAddOns.form.descriptionIn', { locale: l })}</span>
                <textarea required rows={3} value={form.description[l]} onChange={(e) => setForm({ ...form, description: { ...form.description, [l]: e.target.value } })} className="border px-3 py-2 text-sm w-full" style={inputStyle} />
              </label>
            ))}
            <label className="text-xs space-y-1">
              <span>{t('adminAddOns.form.promoVideoUrl')}</span>
              <input type="url" value={form.promoVideoUrl} onChange={(e) => setForm({ ...form, promoVideoUrl: e.target.value })} className="border px-3 py-2 text-sm w-full" style={inputStyle} />
            </label>
            <label className="text-xs space-y-1">
              <span>{t('adminAddOns.form.screenshotUrls')}</span>
              <textarea rows={3} value={form.screenshotUrls} onChange={(e) => setForm({ ...form, screenshotUrls: e.target.value })} className="border px-3 py-2 text-sm w-full" style={inputStyle} />
            </label>
            <label className="text-xs space-y-1">
              <span>{t('adminAddOns.form.trialDays')}</span>
              <input type="number" min={0} max={90} required value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} className="border px-3 py-2 text-sm w-full" style={inputStyle} />
            </label>
            <label className="text-xs space-y-1">
              <span>{t('adminAddOns.form.sortOrder')}</span>
              <input type="number" min={0} required value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} className="border px-3 py-2 text-sm w-full" style={inputStyle} />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t('adminAddOns.prices.title')}</legend>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PLATFORM_BILLING_CURRENCIES.map((currency) => (
                <div key={currency} className="space-y-1">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={t('adminAddOns.prices.monthlyIn', { currency })}
                    placeholder={t('adminAddOns.prices.monthlyIn', { currency })}
                    value={prices[currency].monthly}
                    onChange={(e) => setPrices({ ...prices, [currency]: { ...prices[currency], monthly: e.target.value } })}
                    className="border px-3 py-2 text-sm w-full"
                    style={inputStyle}
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={t('adminAddOns.prices.yearlyIn', { currency })}
                    placeholder={t('adminAddOns.prices.yearlyIn', { currency })}
                    value={prices[currency].yearly}
                    onChange={(e) => setPrices({ ...prices, [currency]: { ...prices[currency], yearly: e.target.value } })}
                    className="border px-3 py-2 text-sm w-full"
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('adminAddOns.prices.hint')}
            </p>
          </fieldset>

          {formError && (
            <p role="alert" className="text-xs" style={{ color: 'var(--color-danger)' }}>
              {formError}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="px-4 py-2 text-sm font-medium" style={primaryButton}>
              {busy ? t('adminAddOns.form.saving') : t('adminAddOns.form.save')}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-medium border" style={{ borderRadius: 'var(--radius-button)', borderColor: 'var(--color-border)' }}>
              {t('adminAddOns.form.cancel')}
            </button>
          </div>
        </form>
      )}

      {loading && !data && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && <EmptyState title={t('adminAddOns.empty.title')} description={t('adminAddOns.empty.description')} />}
      {data && data.items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((a) => (
            <div key={a.id} className="p-5 border space-y-2" style={surface} data-testid={`admin-add-on-${a.key}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{localizedText(a.name, locale)}</h3>
                <span className="px-2 py-0.5 text-xs font-medium" style={{ borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-surface-muted)', color: 'var(--color-text-secondary)' }}>
                  {a.isPublished ? t('adminAddOns.status.published') : t('adminAddOns.status.draft')}
                </span>
              </div>
              <p className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
                {a.key}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {t('adminAddOns.flagLine', { flag: a.featureFlagKey })}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {t('adminAddOns.trialLine', { count: a.trialDays })}
              </p>
              <ul className="text-xs space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
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
              <p className="text-xs font-medium">{t('adminAddOns.tenantCount', { count: a.tenantCount })}</p>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => open(a)} className="text-xs font-medium underline">
                  {t('adminAddOns.edit')}
                </button>
                <button type="button" onClick={() => togglePublish(a)} className="text-xs font-medium underline">
                  {a.isPublished ? t('adminAddOns.unpublish') : t('adminAddOns.publish')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="p-5 border space-y-2" style={surface} aria-labelledby="add-on-revenue">
        <h3 id="add-on-revenue" className="text-sm font-semibold">
          {t('adminAddOns.revenue.title')}
        </h3>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('adminAddOns.revenue.hint')}
        </p>
        {revenue.data && revenue.data.items.length === 0 && <p className="text-sm">{t('adminAddOns.revenue.empty')}</p>}
        <ul className="text-sm space-y-1">
          {(revenue.data?.items ?? []).map((r) => (
            <li key={r.currency}>{t('adminAddOns.revenue.line', { amount: formatMoney(r.amount, r.currency, locale), count: r.payments })}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
