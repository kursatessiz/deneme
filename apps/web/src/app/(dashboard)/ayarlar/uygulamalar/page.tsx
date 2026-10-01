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
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

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
    <div className="grid gap-6">
      <SettingsHeader title={t('addOns.title')} description={t('addOns.subtitle')} />
      <p className="ui-caption">{t('addOns.billingCurrency', { currency: data.billingCurrency })}</p>

      {data.items.length === 0 ? (
        <EmptyState title={t('addOns.empty.title')} description={t('addOns.empty.description')} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.items.map((item) => {
            const working = busyKey === item.key;
            const name = localizedText(item.name, locale);
            return (
              <Card as="article" key={item.key} className="grid gap-3 p-5" data-testid={`add-on-${item.key}`} aria-label={name}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="ui-heading">{name}</h3>
                  <Badge className="shrink-0">{t(`addOns.state.${item.state}`)}</Badge>
                </div>
                <p className="ui-text-muted">{localizedText(item.description, locale)}</p>

                {item.promoVideoUrl && (
                  <a href={item.promoVideoUrl} target="_blank" rel="noopener noreferrer" className="pui-link pui-theme ui-strong">
                    {t('addOns.video')}
                  </a>
                )}
                {item.screenshotUrls.length > 0 && (
                  <ul className="flex gap-2 overflow-x-auto">
                    {item.screenshotUrls.map((url, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <li key={url} className="pui-card shrink-0">
                        <img src={url} alt={t('addOns.screenshot', { index: index + 1 })} className="h-24 w-auto" loading="lazy" />
                      </li>
                    ))}
                  </ul>
                )}

                {item.price ? (
                  <p className="ui-strong">
                    {t('addOns.price.month', { price: formatMoney(item.price.priceMonthly, item.price.currency, locale) })}
                    {' · '}
                    {t('addOns.price.year', { price: formatMoney(item.price.priceYearly, item.price.currency, locale) })}
                  </p>
                ) : (
                  <p className="ui-text-muted">{t('addOns.price.none', { currency: data.billingCurrency })}</p>
                )}

                {item.state === 'AVAILABLE' && item.trialAvailable && <p className="ui-caption">{t('addOns.trial.days', { count: item.trialDays })}</p>}
                {item.state === 'TRIALING' && item.trialDaysLeft !== null && (
                  <p className="ui-caption">
                    {t('addOns.trial.left', { count: item.trialDaysLeft })} ({t('addOns.trial.endsOn', { date: formatDate(item.trialEndsAt, locale) })})
                  </p>
                )}
                {item.state === 'ACTIVE' && item.currentPeriodEnd && (
                  <p className="ui-caption">{t('addOns.period.renews', { date: formatDate(item.currentPeriodEnd, locale) })}</p>
                )}
                {item.state === 'CANCELLED' && item.currentPeriodEnd && (
                  <p className="ui-caption">{t('addOns.period.accessUntil', { date: formatDate(item.currentPeriodEnd, locale) })}</p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {item.trialAvailable && (
                    <Button disabled={working} onClick={() => run(item, 'start-trial')}>
                      {working ? t('addOns.action.working') : t('addOns.action.startTrial')}
                    </Button>
                  )}
                  {item.purchasable && item.state !== 'ACTIVE' && item.price && (
                    <>
                      <Button
                        variant={item.trialAvailable ? 'outline' : 'solid'}
                        tone={item.trialAvailable ? 'surface' : 'theme'}
                        disabled={working}
                        onClick={() => run(item, 'activate', { interval: 'MONTH' })}
                      >
                        {item.state === 'EXPIRED' ? t('addOns.action.reactivate') : t('addOns.action.activateMonthly')}
                      </Button>
                      <Button variant="outline" tone="surface" disabled={working} onClick={() => run(item, 'activate', { interval: 'YEAR' })}>
                        {t('addOns.action.activateYearly')}
                      </Button>
                    </>
                  )}
                  {item.state === 'ACTIVE' && item.paymentOverdue && (
                    <Button disabled={working} onClick={() => run(item, 'activate', { interval: item.billingInterval ?? 'MONTH' })}>
                      {t('addOns.action.activate')}
                    </Button>
                  )}
                  {(item.state === 'TRIALING' || item.state === 'ACTIVE') && (
                    <Button variant="outline" tone="surface" disabled={working} onClick={() => run(item, 'cancel')}>
                      {t('addOns.action.cancel')}
                    </Button>
                  )}
                </div>

                {message?.key === item.key && (
                  <p role="status">
                    {message.text}{' '}
                    {message.checkoutUrl && (
                      <a href={message.checkoutUrl} className="pui-link pui-theme ui-strong">
                        {t('addOns.action.openCheckout')}
                      </a>
                    )}
                  </p>
                )}
                {actionError?.key === item.key && (
                  <p role="alert" className="ui-text-error">
                    {actionError.text}
                  </p>
                )}
              </Card>
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
