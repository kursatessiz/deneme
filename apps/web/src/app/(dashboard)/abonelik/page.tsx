'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActivateStudioResultDTO, PlatformPaymentDTO, StudioBillingDTO } from '@platform/shared';
import { PageGuard } from '@/components/common/PageGuard';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { useT, useLocale } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { formatMoney } from '@/lib/money';
import { CreditSummary } from '@/components/billing/CreditSummary';

const card: React.CSSProperties = {
  borderRadius: 'var(--radius-card)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
};

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** "Abonelik" (G5c-1): status, trial end, plan, credit, the "Hesabı etkinleştir" flow and platform payments. Owner only. */
function BillingPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { activeStudioId } = useDashboardSession();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useBff<StudioBillingDTO>(`studios/${activeStudioId}/billing`, activeStudioId, refreshKey);
  const payments = useBff<{ items: PlatformPaymentDTO[] }>(`studios/${activeStudioId}/billing/payments`, activeStudioId, refreshKey);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ActivateStudioResultDTO | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? t('billing.loadFailed')} />;

  const selected = planKey ?? data.plan?.key ?? data.plans[0]?.key ?? null;
  const canActivate = data.status !== 'ACTIVE';

  const activate = async () => {
    if (!selected) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await bffFetch<ActivateStudioResultDTO>(`studios/${activeStudioId}/billing/activate`, {
        method: 'POST',
        body: { planKey: selected },
        studioId: activeStudioId,
      });
      setResult(res);
      setRefreshKey((k) => k + 1);
      // The banner lives in the server layout: refresh it from the new session.
      router.refresh();
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('billing.activate.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t('billing.summary.status'), value: t(`billing.status.${data.status}`) },
    ...(data.status === 'TRIALING' || data.status === 'RESTRICTED'
      ? [{ label: t('billing.summary.trialEnds'), value: formatDate(data.trialEndsAt, locale) }]
      : []),
    ...(data.activatedAt ? [{ label: t('billing.summary.activatedAt'), value: formatDate(data.activatedAt, locale) }] : []),
    ...(data.plan ? [{ label: t('billing.summary.plan'), value: data.plan.name }] : []),
    ...(data.status === 'ACTIVE' && data.currentPeriodEnd ? [{ label: t('billing.summary.periodEnd'), value: formatDate(data.currentPeriodEnd, locale) }] : []),
    { label: t('billing.summary.credit'), value: <CreditSummary credit={data.credit} /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {t('billing.page.title')}
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('billing.page.subtitle')}
        </p>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 p-5 border" style={card} data-testid="billing-summary">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 text-sm">
            <dt style={{ color: 'var(--color-text-secondary)' }}>{row.label}</dt>
            <dd className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {result && !result.pending && result.status === 'ACTIVE' && (
        <p role="status" className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {t('billing.activate.success')}
        </p>
      )}
      {result?.pending && (
        <div role="status" className="text-sm space-y-2" style={{ color: 'var(--color-text-primary)' }}>
          <p>{t('billing.activate.pending')}</p>
          {result.checkoutUrl && (
            <a href={result.checkoutUrl} className="underline font-medium">
              {t('billing.activate.redirect')}
            </a>
          )}
        </div>
      )}

      {canActivate ? (
        <section aria-labelledby="activate-heading" className="p-5 border space-y-4" style={card}>
          <div>
            <h3 id="activate-heading" className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {t('billing.activate.title')}
            </h3>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              {t('billing.activate.description')}
            </p>
          </div>
          {data.plans.length === 0 ? (
            <p className="text-sm">{t('billing.activate.noPlans')}</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                {t('billing.activate.choosePlan')}
              </legend>
              {data.plans.map((plan) => (
                <label
                  key={plan.key}
                  className="flex items-center justify-between gap-3 px-4 py-3 border cursor-pointer text-sm"
                  style={{
                    borderRadius: 'var(--radius-input)',
                    borderColor: selected === plan.key ? 'var(--color-primary)' : 'var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <span className="flex items-center gap-3">
                    <input type="radio" name="plan" value={plan.key} checked={selected === plan.key} onChange={() => setPlanKey(plan.key)} />
                    <span className="font-medium">{plan.name}</span>
                  </span>
                  <span>{t('billing.activate.perMonth', { price: formatMoney(plan.priceMonthly, plan.currency, locale) })}</span>
                </label>
              ))}
            </fieldset>
          )}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('billing.activate.creditNote')}
          </p>
          {actionError && (
            <p role="alert" className="text-xs" style={{ color: 'var(--color-danger, #b42318)' }}>
              {actionError}
            </p>
          )}
          <button
            type="button"
            onClick={activate}
            disabled={submitting || !selected || Boolean(result?.pending)}
            className="px-4 py-2 text-sm font-semibold disabled:opacity-60"
            style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
          >
            {submitting ? t('billing.activate.submitting') : t('billing.activate.submit')}
          </button>
        </section>
      ) : (
        !result && (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {t('billing.activate.alreadyActive')}
          </p>
        )
      )}

      <section aria-labelledby="payments-heading" className="space-y-3">
        <h3 id="payments-heading" className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('billing.payments.title')}
        </h3>
        {payments.data && payments.data.items.length > 0 ? (
          <div className="overflow-x-auto border" style={card}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                  {(['date', 'plan', 'amount', 'credit', 'status'] as const).map((col) => (
                    <th key={col} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                      {t(`billing.payments.col.${col}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.data.items.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
                    <td className="px-3 py-2">{formatDate(p.paidAt ?? p.createdAt, locale)}</td>
                    <td className="px-3 py-2">{p.planKey}</td>
                    <td className="px-3 py-2">{formatMoney(p.amount, p.currency, locale)}</td>
                    <td className="px-3 py-2">
                      <CreditSummary credit={{ amounts: Number(p.creditAmount) > 0 ? [{ currency: p.currency, amount: p.creditAmount }] : [], months: p.creditMonths }} />
                    </td>
                    <td className="px-3 py-2">{t(`billing.payments.status.${p.status}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {t('billing.payments.empty')}
          </p>
        )}
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['billing.manage']}>
      <BillingPage />
    </PageGuard>
  );
}
