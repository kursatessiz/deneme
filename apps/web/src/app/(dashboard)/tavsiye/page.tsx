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
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {t('billing.referral.title')}
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('billing.referral.subtitle')}
        </p>
      </div>

      <section className="p-5 border space-y-3" style={card} aria-label={t('billing.referral.linkLabel')}>
        <label className="block text-xs font-medium" htmlFor="referral-link" style={{ color: 'var(--color-text-secondary)' }}>
          {t('billing.referral.linkLabel')}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="referral-link"
            readOnly
            value={link}
            className="flex-1 min-w-[16rem] border px-3 py-2 text-sm"
            style={{ borderRadius: 'var(--radius-input)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-background)' }}
          />
          <button
            type="button"
            onClick={copy}
            className="px-4 py-2 text-sm font-semibold"
            style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
          >
            {copied ? t('billing.referral.copied') : t('billing.referral.copy')}
          </button>
        </div>
        <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
          {t('billing.referral.codeLabel')}: <span className="font-mono font-semibold" data-testid="referral-code">{data.code}</span>
        </p>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {rewardText}
        </p>
      </section>

      <section className="p-5 border flex flex-wrap items-center justify-between gap-3" style={card}>
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('billing.referral.earned')}
          </p>
          <p className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            <CreditSummary credit={data.credit} />
          </p>
        </div>
        <p className="text-xs max-w-sm" style={{ color: 'var(--color-text-muted)' }}>
          {t('billing.referral.creditNote')}
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="referral-list-heading">
        <h3 id="referral-list-heading" className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('billing.referral.listTitle')}
        </h3>
        {data.referrals.length === 0 ? (
          <EmptyState title={t('billing.referral.empty.title')} description={t('billing.referral.empty.description')} />
        ) : (
          <div className="overflow-x-auto border" style={card}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                  {(['business', 'status', 'date', 'reward'] as const).map((col) => (
                    <th key={col} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                      {t(`billing.referral.col.${col}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.referrals.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
                    <td className="px-3 py-2 font-medium">{r.referredStudioName}</td>
                    <td className="px-3 py-2">
                      {t(`billing.referral.status.${r.status}`)}
                      {r.rejectReason && (
                        <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          {t(`billing.referral.reject.${r.rejectReason}`)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{formatDate(r.createdAt, locale)}</td>
                    <td className="px-3 py-2">
                      <RewardText reward={r.reward} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
