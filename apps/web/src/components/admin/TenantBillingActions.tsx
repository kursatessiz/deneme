'use client';

import { useState } from 'react';
import { PLATFORM_BILLING_CURRENCIES } from '@platform/shared';
import type { PlatformBillingCurrency, StudioBillingStatus } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

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
    <div className="grid gap-1 min-w-[12rem]">
      <p className="ui-small ui-strong">{t(`billing.status.${status}`)}</p>
      {trialEnd && <p className="ui-caption">{trialEnd}</p>}
      <p className="ui-caption">
        {t('adminBilling.tenants.billingCurrency', { currency: billingCurrency })}{' '}
        {billingCurrencyOverride ? t('adminBilling.tenants.currencyOverridden') : t('adminBilling.tenants.currencyFromCountry', { country: countryCode })}
      </p>
      {mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          {(status === 'TRIALING' || status === 'RESTRICTED') && (
            <Button variant="link" tone="surface" size="sm" onClick={() => setMode('extend')}>
              {t('adminBilling.tenants.extend')}
            </Button>
          )}
          {status !== 'ACTIVE' && (
            <Button variant="link" tone="surface" size="sm" onClick={() => setMode('ACTIVE')}>
              {t('adminBilling.tenants.forceActivate')}
            </Button>
          )}
          {status !== 'RESTRICTED' && status !== 'CANCELLED' && (
            <Button variant="link" tone="surface" size="sm" onClick={() => setMode('RESTRICTED')}>
              {t('adminBilling.tenants.forceRestrict')}
            </Button>
          )}
          <Button variant="link" tone="surface" size="sm" onClick={() => setMode('currency')}>
            {t('adminBilling.tenants.changeCurrency')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'extend' ? (
            <Input
              type="number"
              min={1}
              max={90}
              aria-label={t('adminBilling.tenants.extendDays')}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-20"
            />
          ) : (
            <>
              {mode === 'currency' && (
                <Select
                  aria-label={t('adminBilling.tenants.currency')}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as PlatformBillingCurrency | '')}
                  className="w-auto"
                >
                  <option value="">{t('adminBilling.tenants.currencyAuto')}</option>
                  {PLATFORM_BILLING_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
              <Input
                aria-label={t('adminBilling.tenants.reason')}
                placeholder={t('adminBilling.tenants.reason')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-auto"
              />
              {mode === 'ACTIVE' && <Checkbox label={t('adminBilling.tenants.recordAsPaid')} checked={recordAsPaid} onChange={(e) => setRecordAsPaid(e.target.checked)} />}
            </>
          )}
          <Button size="sm" disabled={busy} onClick={submit}>
            {mode === 'extend'
              ? t('adminBilling.tenants.extendSubmit')
              : mode === 'ACTIVE'
                ? t('adminBilling.tenants.forceActivate')
                : mode === 'currency'
                  ? t('adminBilling.tenants.currencySave')
                  : t('adminBilling.tenants.forceRestrict')}
          </Button>
          <Button variant="link" tone="surface" size="sm" onClick={() => setMode('idle')}>
            {t('adminBilling.tenants.cancel')}
          </Button>
        </div>
      )}
      {error && <p className="ui-caption ui-text-error">{error}</p>}
    </div>
  );
}
