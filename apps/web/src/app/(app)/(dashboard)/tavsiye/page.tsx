'use client';

import { useEffect, useState } from 'react';
import type { ReferralRewardEntry, StudioReferralOverviewDTO } from '@platform/shared';
import { PageGuard } from '@/components/common/PageGuard';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { CreditSummary } from '@/components/billing/CreditSummary';
import { useBff } from '@/lib/session/use-bff';
import { formatMoney } from '@/lib/money';
import { Input, Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function RewardText({ reward }: { reward: ReferralRewardEntry | null }) {
  const t = useT();
  const locale = useLocale();
  if (!reward) return <>-</>;
  if (reward.amount && reward.currency) return <>{formatMoney(reward.amount, reward.currency, locale)}</>;
  if (reward.months) return <>{t('billing.summary.creditMonths', { count: reward.months })}</>;
  return <>-</>;
}

/** "Tavsiye et" (G5c-1): the business's referral link and code, businesses it referred and the credit it earned. Owner only. */
function ReferralPage() {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<StudioReferralOverviewDTO>(`studios/${activeStudioId}/business-referrals`, activeStudioId);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? undefined} />;

  // The platform site answers on the same origin under /<locale>.
  const link = `${origin}/${locale}${data.query}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const rewardText =
    data.reward.amount && data.reward.currency
      ? t('billing.referral.rewardAmount', { amount: formatMoney(data.reward.amount, data.reward.currency, locale) })
      : t('billing.referral.rewardMonths', { count: data.reward.months ?? 1 });

  return (
    <div className="space-y-6">
      <PageHeader title={t('billing.referral.title')} description={t('billing.referral.subtitle')} />

      <section className="pui-card p-5 space-y-3" aria-label={t('billing.referral.linkLabel')}>
        <label className="block ui-strong ui-caption" htmlFor="referral-link">
          {t('billing.referral.linkLabel')}
        </label>
        <div className="flex flex-wrap gap-2">
          <Input id="referral-link" readOnly value={link} className="flex-1 min-w-[16rem]" />
          <Button size="sm" onClick={copy}>
            {copied ? t('billing.referral.copied') : t('billing.referral.copy')}
          </Button>
        </div>
        <p>
          {t('billing.referral.codeLabel')}: <span className="ui-mono ui-strong" data-testid="referral-code">{data.code}</span>
        </p>
        <p className="ui-text-muted">
          {rewardText}
        </p>
      </section>

      <section className="pui-card p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="ui-strong ui-caption">
            {t('billing.referral.earned')}
          </p>
          <p className="ui-heading">
            <CreditSummary credit={data.credit} />
          </p>
        </div>
        <p className="max-w-sm ui-caption">
          {t('billing.referral.creditNote')}
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="referral-list-heading">
        <h3 id="referral-list-heading" className="ui-strong">
          {t('billing.referral.listTitle')}
        </h3>
        {data.referrals.length === 0 ? (
          <EmptyState title={t('billing.referral.empty.title')} description={t('billing.referral.empty.description')} />
        ) : (
          <div className="pui-card overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  {(['business', 'status', 'date', 'reward'] as const).map((col) => (
                    <Th key={col}>
                      {t(`billing.referral.col.${col}`)}
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {data.referrals.map((r) => (
                  <Tr key={r.id}>
                    <Td className="ui-strong">{r.referredStudioName}</Td>
                    <Td>
                      {t(`billing.referral.status.${r.status}`)}
                      {r.rejectReason && (
                        <span className="block ui-caption">
                          {t(`billing.referral.reject.${r.rejectReason}`)}
                        </span>
                      )}
                    </Td>
                    <Td>{formatDate(r.createdAt, locale)}</Td>
                    <Td>
                      <RewardText reward={r.reward} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['billing.manage']}>
      <ReferralPage />
    </PageGuard>
  );
}
