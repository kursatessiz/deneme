'use client';

import { useEffect, useState } from 'react';
import { PLATFORM_BILLING_CURRENCIES } from '@platform/shared';
import type { AdminReferralOverviewDTO, PlatformBillingCurrency, ReferralRewardKind, ReferralRewardSetting } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};
const card: React.CSSProperties = { borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' };

function RewardSettingForm({ current, onSaved }: { current: ReferralRewardSetting; onSaved: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<ReferralRewardKind>(current.kind);
  // One amount per billing currency; the referrer earns it in its own currency.
  const [amounts, setAmounts] = useState<Record<PlatformBillingCurrency, string>>(
    () =>
      Object.fromEntries(
        PLATFORM_BILLING_CURRENCIES.map((c) => [c, current.kind === 'AMOUNT' ? (current.amounts.find((a) => a.currency === c)?.amount ?? '') : '']),
      ) as Record<PlatformBillingCurrency, string>,
  );
  const [months, setMonths] = useState(current.kind === 'FREE_MONTHS' ? String(current.months) : '1');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setKind(current.kind);
  }, [current.kind]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const referralReward =
        kind === 'AMOUNT'
          ? {
              kind,
              amounts: PLATFORM_BILLING_CURRENCIES.filter((c) => amounts[c].trim() !== '').map((c) => ({ currency: c, amount: amounts[c].trim() })),
            }
          : { kind, months: Number(months) };
      await bffFetch('admin/billing/settings', { method: 'PUT', body: { referralReward } });
      setMessage(t('adminBilling.settings.saved'));
      onSaved();
    } catch (err) {
      setMessage(err instanceof BffError ? err.message : t('adminBilling.settings.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="p-5 border space-y-3" style={card}>
      <div>
        <h3 className="text-sm font-semibold">{t('adminBilling.settings.title')}</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminBilling.settings.description')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label={t('adminBilling.settings.kind')} value={kind} onChange={(e) => setKind(e.target.value as ReferralRewardKind)} className="border px-3 py-2 text-sm" style={inputStyle}>
          <option value="FREE_MONTHS">{t('adminBilling.settings.kind.FREE_MONTHS')}</option>
          <option value="AMOUNT">{t('adminBilling.settings.kind.AMOUNT')}</option>
        </select>
        {kind === 'AMOUNT' ? (
          <>
            {PLATFORM_BILLING_CURRENCIES.map((c) => (
              <input
                key={c}
                inputMode="decimal"
                aria-label={t('adminBilling.settings.amountIn', { currency: c })}
                placeholder={t('adminBilling.settings.amountIn', { currency: c })}
                value={amounts[c]}
                onChange={(e) => setAmounts({ ...amounts, [c]: e.target.value })}
                className="border px-3 py-2 text-sm w-36"
                style={inputStyle}
              />
            ))}
          </>
        ) : (
          <input required type="number" min={1} max={12} aria-label={t('adminBilling.settings.months')} placeholder={t('adminBilling.settings.months')} value={months} onChange={(e) => setMonths(e.target.value)} className="border px-3 py-2 text-sm w-24" style={inputStyle} />
        )}
        <button type="submit" disabled={busy} className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {t('adminBilling.settings.save')}
        </button>
      </div>
      {kind === 'AMOUNT' && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('adminBilling.settings.amountsHint')}
        </p>
      )}
      {message && <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>}
    </form>
  );
}

/** Super admin: business-to-business referral overview and the reward setting (G5c-1). */
export default function AdminReferralsPage() {
  const t = useT();
  const locale = useLocale();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<AdminReferralOverviewDTO>('admin/business-referrals', null, refreshKey);

  if (forbidden) return <EmptyState title={t('adminPlans.accessDenied')} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('adminBilling.referrals.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminBilling.referrals.subtitle')}
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && (
        <>
          <RewardSettingForm current={data.reward} onSaved={() => setRefreshKey((k) => k + 1)} />
          <dl className="grid grid-cols-3 gap-4">
            {(['signedUp', 'rewarded', 'rejected'] as const).map((key) => (
              <div key={key} className="p-4 border" style={card}>
                <dt className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {t(`adminBilling.referrals.totals.${key}`)}
                </dt>
                <dd className="text-2xl font-semibold">{data.totals[key]}</dd>
              </div>
            ))}
          </dl>
          {data.items.length === 0 ? (
            <EmptyState title={t('adminBilling.referrals.empty')} />
          ) : (
            <div className="overflow-x-auto border" style={card}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                    {(['referrer', 'referred', 'code', 'source', 'status', 'date'] as const).map((col) => (
                      <th key={col} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                        {t(`adminBilling.referrals.col.${col}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-3 py-2 font-medium">{r.referrerStudioName}</td>
                      <td className="px-3 py-2">{r.referredStudioName}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                      <td className="px-3 py-2">{t(`adminBilling.referrals.source.${r.source}`)}</td>
                      <td className="px-3 py-2">
                        {t(`billing.referral.status.${r.status}`)}
                        {r.rejectReason && (
                          <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {t(`billing.referral.reject.${r.rejectReason}`)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(r.createdAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
