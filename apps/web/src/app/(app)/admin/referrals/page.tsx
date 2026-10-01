'use client';

import { useEffect, useState } from 'react';
import { PLATFORM_BILLING_CURRENCIES } from '@platform/shared';
import type { AdminReferralOverviewDTO, PlatformBillingCurrency, ReferralRewardKind, ReferralRewardSetting } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';

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
    <Card as="section">
      <form onSubmit={save} className="pui-card-content">
        <div className="grid gap-1">
          <h3 className="ui-heading">{t('adminBilling.settings.title')}</h3>
          <p className="ui-caption">{t('adminBilling.settings.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select aria-label={t('adminBilling.settings.kind')} value={kind} onChange={(e) => setKind(e.target.value as ReferralRewardKind)} className="w-auto">
            <option value="FREE_MONTHS">{t('adminBilling.settings.kind.FREE_MONTHS')}</option>
            <option value="AMOUNT">{t('adminBilling.settings.kind.AMOUNT')}</option>
          </Select>
          {kind === 'AMOUNT' ? (
            <>
              {PLATFORM_BILLING_CURRENCIES.map((c) => (
                <Input
                  key={c}
                  inputMode="decimal"
                  aria-label={t('adminBilling.settings.amountIn', { currency: c })}
                  placeholder={t('adminBilling.settings.amountIn', { currency: c })}
                  value={amounts[c]}
                  onChange={(e) => setAmounts({ ...amounts, [c]: e.target.value })}
                  className="w-36"
                />
              ))}
            </>
          ) : (
            <Input required type="number" min={1} max={12} aria-label={t('adminBilling.settings.months')} placeholder={t('adminBilling.settings.months')} value={months} onChange={(e) => setMonths(e.target.value)} className="w-24" />
          )}
          <Button type="submit" disabled={busy}>
            {t('adminBilling.settings.save')}
          </Button>
        </div>
        {kind === 'AMOUNT' && <p className="ui-caption">{t('adminBilling.settings.amountsHint')}</p>}
        {message && <p className="ui-caption">{message}</p>}
      </form>
    </Card>
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
    <div className="grid gap-6">
      <PageHeader title={t('adminBilling.referrals.title')} description={t('adminBilling.referrals.subtitle')} />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && (
        <>
          <RewardSettingForm current={data.reward} onSaved={() => setRefreshKey((k) => k + 1)} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(['signedUp', 'rewarded', 'rejected'] as const).map((key) => (
              <StatTile key={key} label={t(`adminBilling.referrals.totals.${key}`)} value={data.totals[key]} />
            ))}
          </div>
          {data.items.length === 0 ? (
            <EmptyState title={t('adminBilling.referrals.empty')} />
          ) : (
            <Card className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    {(['referrer', 'referred', 'code', 'source', 'status', 'date'] as const).map((col) => (
                      <Th key={col}>{t(`adminBilling.referrals.col.${col}`)}</Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {data.items.map((r) => (
                    <Tr key={r.id}>
                      <Td className="ui-strong">{r.referrerStudioName}</Td>
                      <Td>{r.referredStudioName}</Td>
                      <Td className="ui-mono">{r.code}</Td>
                      <Td>{t(`adminBilling.referrals.source.${r.source}`)}</Td>
                      <Td>
                        {t(`billing.referral.status.${r.status}`)}
                        {r.rejectReason && <span className="block ui-caption">{t(`billing.referral.reject.${r.rejectReason}`)}</span>}
                      </Td>
                      <Td>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(r.createdAt))}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
