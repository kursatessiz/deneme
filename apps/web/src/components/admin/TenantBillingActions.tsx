'use client';

import { useState } from 'react';
import { PLATFORM_BILLING_CURRENCIES } from '@platform/shared';
import type { PlatformBillingCurrency, StudioBillingStatus } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

/**
 * Super-admin billing cell of the tenants table (G5c-1): status, trial end,
 * billing currency and the audit-logged actions (extend trial, activate
 * without payment, optionally counted as a paying customer, restrict,
 * override the billing currency). The API refuses transitions that are not
 * allowed.
 */
export function TenantBillingActions({
  studioId,
  status,
  trialEndsAt,
  countryCode,
  billingCurrency,
  billingCurrencyOverride,
  onChanged,
}: {
  studioId: string;
  status: StudioBillingStatus;
  trialEndsAt: string | null;
  countryCode: string;
  billingCurrency: PlatformBillingCurrency;
  billingCurrencyOverride: PlatformBillingCurrency | null;
  onChanged: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<'idle' | 'extend' | 'ACTIVE' | 'RESTRICTED' | 'currency'>('idle');
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  const [recordAsPaid, setRecordAsPaid] = useState(false);
  const [currency, setCurrency] = useState<PlatformBillingCurrency | ''>(billingCurrencyOverride ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'extend') {
        await bffFetch(`admin/tenants/${studioId}/trial/extend`, { method: 'POST', body: { days: Number(days) } });
      } else if (mode === 'ACTIVE' || mode === 'RESTRICTED') {
        await bffFetch(`admin/tenants/${studioId}/billing-status`, {
          method: 'POST',
          body: { status: mode, ...(mode === 'ACTIVE' ? { recordAsPaid } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) },
        });
      } else if (mode === 'currency') {
        await bffFetch(`admin/tenants/${studioId}/billing-currency`, {
          method: 'PUT',
          body: { currency: currency === '' ? null : currency, ...(reason.trim() ? { reason: reason.trim() } : {}) },
        });
      }
      setMode('idle');
      setReason('');
      setRecordAsPaid(false);
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('adminBilling.tenants.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const trialEnd =
    trialEndsAt && (status === 'TRIALING' || status === 'RESTRICTED')
      ? t('adminBilling.tenants.trialEnds', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(trialEndsAt)) })
      : null;

  return (
    <div className="space-y-1 min-w-[12rem]">
      <p className="text-xs font-medium">{t(`billing.status.${status}`)}</p>
      {trialEnd && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {trialEnd}
        </p>
      )}
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('adminBilling.tenants.billingCurrency', { currency: billingCurrency })}{' '}
        {billingCurrencyOverride ? t('adminBilling.tenants.currencyOverridden') : t('adminBilling.tenants.currencyFromCountry', { country: countryCode })}
      </p>
      {mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          {(status === 'TRIALING' || status === 'RESTRICTED') && (
            <button type="button" onClick={() => setMode('extend')} className="text-xs underline" style={{ color: 'var(--color-text-secondary)' }}>
              {t('adminBilling.tenants.extend')}
            </button>
          )}
          {status !== 'ACTIVE' && (
            <button type="button" onClick={() => setMode('ACTIVE')} className="text-xs underline" style={{ color: 'var(--color-text-secondary)' }}>
              {t('adminBilling.tenants.forceActivate')}
            </button>
          )}
          {status !== 'RESTRICTED' && status !== 'CANCELLED' && (
            <button type="button" onClick={() => setMode('RESTRICTED')} className="text-xs underline" style={{ color: 'var(--color-text-secondary)' }}>
              {t('adminBilling.tenants.forceRestrict')}
            </button>
          )}
          <button type="button" onClick={() => setMode('currency')} className="text-xs underline" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminBilling.tenants.changeCurrency')}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'extend' ? (
            <input
              type="number"
              min={1}
              max={90}
              aria-label={t('adminBilling.tenants.extendDays')}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-16 border px-2 py-1 text-xs"
              style={inputStyle}
            />
          ) : (
            <>
            {mode === 'currency' && (
              <select
                aria-label={t('adminBilling.tenants.currency')}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as PlatformBillingCurrency | '')}
                className="border px-2 py-1 text-xs"
                style={inputStyle}
              >
                <option value="">{t('adminBilling.tenants.currencyAuto')}</option>
                {PLATFORM_BILLING_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            <input
              aria-label={t('adminBilling.tenants.reason')}
              placeholder={t('adminBilling.tenants.reason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="border px-2 py-1 text-xs"
              style={inputStyle}
            />
            {mode === 'ACTIVE' && (
              <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <input type="checkbox" checked={recordAsPaid} onChange={(e) => setRecordAsPaid(e.target.checked)} />
                {t('adminBilling.tenants.recordAsPaid')}
              </label>
            )}
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="px-2.5 py-1 text-xs font-medium"
            style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
          >
            {mode === 'extend'
              ? t('adminBilling.tenants.extendSubmit')
              : mode === 'ACTIVE'
                ? t('adminBilling.tenants.forceActivate')
                : mode === 'currency'
                  ? t('adminBilling.tenants.currencySave')
                  : t('adminBilling.tenants.forceRestrict')}
          </button>
          <button type="button" onClick={() => setMode('idle')} className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminBilling.tenants.cancel')}
          </button>
        </div>
      )}
      {error && (
        <p className="text-xs" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
