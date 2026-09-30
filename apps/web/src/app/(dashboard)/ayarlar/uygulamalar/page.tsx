'use client';

import { useState } from 'react';
import { localizedText } from '@platform/shared';
import type { AddOnInterval, StudioAddOnActionResultDTO, StudioAddOnDTO, StudioAddOnListDTO } from '@platform/shared';
import { PageGuard } from '@/components/common/PageGuard';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { SettingsHeader } from '@/components/settings/ui';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { formatMoney } from '@/lib/money';

const surface: React.CSSProperties = {
  borderRadius: 'var(--radius-card)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
};

const primaryButton: React.CSSProperties = {
  borderRadius: 'var(--radius-button)',
  backgroundColor: 'var(--color-primary)',
  color: 'var(--color-on-primary)',
};

const secondaryButton: React.CSSProperties = {
  borderRadius: 'var(--radius-button)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-primary)',
};

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** App marketplace (G5c-2): try, buy and cancel add-on modules. Owner only (billing.manage). */
function AddOnsPage() {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useBff<StudioAddOnListDTO>(`studios/${activeStudioId}/add-ons`, activeStudioId, refreshKey);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ key: string; text: string; checkoutUrl?: string | null } | null>(null);
  const [actionError, setActionError] = useState<{ key: string; text: string } | null>(null);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? t('addOns.loadFailed')} />;

  const run = async (item: StudioAddOnDTO, action: 'start-trial' | 'activate' | 'cancel', body?: { interval: AddOnInterval }) => {
    if (action === 'cancel' && !window.confirm(t('addOns.action.cancelConfirm'))) return;
    setBusyKey(item.key);
    setActionError(null);
    setMessage(null);
    try {
      const res = await bffFetch<StudioAddOnActionResultDTO>(`studios/${activeStudioId}/add-ons/${item.key}/${action}`, {
        method: 'POST',
        body: body ?? {},
        studioId: activeStudioId,
      });
      if (res.pending) setMessage({ key: item.key, text: t('addOns.action.pendingCheckout'), checkoutUrl: res.checkoutUrl });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError({ key: item.key, text: err instanceof BffError ? err.message : t('addOns.actionFailed') });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsHeader title={t('addOns.title')} description={t('addOns.subtitle')} />
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('addOns.billingCurrency', { currency: data.billingCurrency })}
      </p>

      {data.items.length === 0 ? (
        <EmptyState title={t('addOns.empty.title')} description={t('addOns.empty.description')} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.items.map((item) => {
            const working = busyKey === item.key;
            const name = localizedText(item.name, locale);
            return (
              <article key={item.key} className="p-5 border space-y-3" style={surface} data-testid={`add-on-${item.key}`} aria-label={name}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {name}
                  </h3>
                  <span className="px-2 py-0.5 text-xs font-medium shrink-0" style={{ borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-surface-muted)', color: 'var(--color-text-secondary)' }}>
                    {t(`addOns.state.${item.state}`)}
                  </span>
                </div>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {localizedText(item.description, locale)}
                </p>

                {item.promoVideoUrl && (
                  <a href={item.promoVideoUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline">
                    {t('addOns.video')}
                  </a>
                )}
                {item.screenshotUrls.length > 0 && (
                  <ul className="flex gap-2 overflow-x-auto">
                    {item.screenshotUrls.map((url, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <li key={url} className="shrink-0">
                        <img src={url} alt={t('addOns.screenshot', { index: index + 1 })} className="h-24 w-auto border" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)' }} loading="lazy" />
                      </li>
                    ))}
                  </ul>
                )}

                {item.price ? (
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {t('addOns.price.month', { price: formatMoney(item.price.priceMonthly, item.price.currency, locale) })}
                    {' · '}
                    {t('addOns.price.year', { price: formatMoney(item.price.priceYearly, item.price.currency, locale) })}
                  </p>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('addOns.price.none', { currency: data.billingCurrency })}
                  </p>
                )}

                {item.state === 'AVAILABLE' && item.trialAvailable && (
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('addOns.trial.days', { count: item.trialDays })}
                  </p>
                )}
                {item.state === 'TRIALING' && item.trialDaysLeft !== null && (
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('addOns.trial.left', { count: item.trialDaysLeft })} ({t('addOns.trial.endsOn', { date: formatDate(item.trialEndsAt, locale) })})
                  </p>
                )}
                {item.state === 'ACTIVE' && item.currentPeriodEnd && (
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('addOns.period.renews', { date: formatDate(item.currentPeriodEnd, locale) })}
                  </p>
                )}
                {item.state === 'CANCELLED' && item.currentPeriodEnd && (
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('addOns.period.accessUntil', { date: formatDate(item.currentPeriodEnd, locale) })}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {item.trialAvailable && (
                    <button type="button" disabled={working} onClick={() => run(item, 'start-trial')} className="px-3 py-1.5 text-sm font-medium" style={primaryButton}>
                      {working ? t('addOns.action.working') : t('addOns.action.startTrial')}
                    </button>
                  )}
                  {item.purchasable && item.state !== 'ACTIVE' && item.price && (
                    <>
                      <button type="button" disabled={working} onClick={() => run(item, 'activate', { interval: 'MONTH' })} className="px-3 py-1.5 text-sm font-medium" style={item.trialAvailable ? secondaryButton : primaryButton}>
                        {item.state === 'EXPIRED' ? t('addOns.action.reactivate') : t('addOns.action.activateMonthly')}
                      </button>
                      <button type="button" disabled={working} onClick={() => run(item, 'activate', { interval: 'YEAR' })} className="px-3 py-1.5 text-sm font-medium" style={secondaryButton}>
                        {t('addOns.action.activateYearly')}
                      </button>
                    </>
                  )}
                  {item.state === 'ACTIVE' && item.paymentOverdue && (
                    <button type="button" disabled={working} onClick={() => run(item, 'activate', { interval: item.billingInterval ?? 'MONTH' })} className="px-3 py-1.5 text-sm font-medium" style={primaryButton}>
                      {t('addOns.action.activate')}
                    </button>
                  )}
                  {(item.state === 'TRIALING' || item.state === 'ACTIVE') && (
                    <button type="button" disabled={working} onClick={() => run(item, 'cancel')} className="px-3 py-1.5 text-sm font-medium" style={secondaryButton}>
                      {t('addOns.action.cancel')}
                    </button>
                  )}
                </div>

                {message?.key === item.key && (
                  <p role="status" className="text-sm">
                    {message.text}{' '}
                    {message.checkoutUrl && (
                      <a href={message.checkoutUrl} className="underline font-medium">
                        {t('addOns.action.openCheckout')}
                      </a>
                    )}
                  </p>
                )}
                {actionError?.key === item.key && (
                  <p role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
                    {actionError.text}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AddOnsSettingsPage() {
  return (
    <PageGuard required={['billing.manage']}>
      <AddOnsPage />
    </PageGuard>
  );
}
