'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { localizedText } from '@platform/shared';
import type { ActivateStudioResultDTO, PlatformPaymentDTO, StudioBillingDTO } from '@platform/shared';
import { PageGuard } from '@/components/common/PageGuard';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { useT, useLocale } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { formatMoney } from '@/lib/money';
import { CreditSummary } from '@/components/billing/CreditSummary';
import { AnchorButton, Button, Card, CardContent, PageHeader, Radio, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';

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
    { label: t('billing.summary.billingCurrency'), value: data.billingCurrency },
    ...(data.status === 'ACTIVE' && data.currentPeriodEnd ? [{ label: t('billing.summary.periodEnd'), value: formatDate(data.currentPeriodEnd, locale) }] : []),
    { label: t('billing.summary.credit'), value: <CreditSummary credit={data.credit} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('billing.page.title')} description={t('billing.page.subtitle')} />

      <Card>
        <dl className="pui-card-content grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3" data-testid="billing-summary">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className="ui-text-muted">{row.label}</dt>
              <dd className="ui-strong">{row.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {result && !result.pending && result.status === 'ACTIVE' && (
        <p role="status" className="ui-strong">
          {t('billing.activate.success')}
        </p>
      )}
      {result?.pending && (
        <div role="status" className="grid gap-2">
          <p>{t('billing.activate.pending')}</p>
          {result.checkoutUrl && (
            <div>
              <AnchorButton href={result.checkoutUrl} variant="link" tone="surface" size="sm">
                {t('billing.activate.redirect')}
              </AnchorButton>
            </div>
          )}
        </div>
      )}

      {canActivate ? (
        <Card as="section" aria-labelledby="activate-heading">
          <CardContent>
            <div className="grid gap-1">
              <h3 id="activate-heading" className="ui-heading">
                {t('billing.activate.title')}
              </h3>
              <p className="ui-text-muted">{t('billing.activate.description')}</p>
            </div>
            {data.plans.length === 0 ? (
              <p>{t('billing.activate.noPlans')}</p>
            ) : (
              <fieldset className="grid gap-2">
                <legend className="ui-caption mb-2">{t('billing.activate.choosePlan')}</legend>
                {data.plans.map((plan) => (
                  <label key={plan.key} className="ui-choice flex items-center justify-between gap-3">
                    <span className="flex items-center gap-3">
                      <Radio name="plan" value={plan.key} checked={selected === plan.key} onChange={() => setPlanKey(plan.key)} />
                      <span className="ui-strong">{plan.name}</span>
                    </span>
                    <span>{t('billing.activate.perMonth', { price: formatMoney(plan.priceMonthly, plan.currency, locale) })}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <p className="ui-caption">
              {t('billing.activate.currencyNote', { currency: data.billingCurrency })} {t('billing.activate.creditNote')}
            </p>
            {actionError && (
              <p role="alert" className="ui-caption ui-text-error">
                {actionError}
              </p>
            )}
            <div>
              <Button onClick={activate} disabled={submitting || !selected || Boolean(result?.pending)}>
                {submitting ? t('billing.activate.submitting') : t('billing.activate.submit')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        !result && <p className="ui-text-muted">{t('billing.activate.alreadyActive')}</p>
      )}

      <section aria-labelledby="payments-heading" className="grid gap-3">
        <h3 id="payments-heading" className="ui-heading">
          {t('billing.payments.title')}
        </h3>
        {payments.data && payments.data.items.length > 0 ? (
          <Card className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  {(['date', 'plan', 'amount', 'credit', 'status'] as const).map((col) => (
                    <Th key={col}>{t(`billing.payments.col.${col}`)}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {payments.data.items.map((p) => (
                  <Tr key={p.id}>
                    <Td>{formatDate(p.paidAt ?? p.createdAt, locale)}</Td>
                    <Td>{p.addOn ? t('addOns.payments.line', { name: localizedText(p.addOn.name, locale) }) : p.planKey ?? '-'}</Td>
                    <Td>{formatMoney(p.amount, p.currency, locale)}</Td>
                    <Td>
                      <CreditSummary credit={{ amounts: Number(p.creditAmount) > 0 ? [{ currency: p.currency, amount: p.creditAmount }] : [], months: p.creditMonths }} />
                    </Td>
                    <Td>{t(`billing.payments.status.${p.status}`)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Card>
        ) : (
          <p className="ui-text-muted">{t('billing.payments.empty')}</p>
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
