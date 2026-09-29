'use client';

import { useState } from 'react';
import type { PayoutDetailDTO, PayoutItemDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { formatMoney } from '@/lib/money';
import { Badge } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { PayoutMatchDialog } from '@/components/finance/PayoutMatchDialog';
import { PAYOUT_STATUS_TONE, RECONCILIATION_TONE } from '@/components/finance/payout-tones';

const MATCHABLE = new Set(['CHARGE', 'REFUND']);

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-card)',
  backgroundColor: 'var(--color-surface)',
};

/** One payout with its items, the payments they are matched to, and the manual match and unmatch actions. */
export function PayoutDetail({ detail, onChange, onBack }: { detail: PayoutDetailDTO; onChange: (detail: PayoutDetailDTO) => void; onBack: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const [matching, setMatching] = useState<PayoutItemDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const money = (amount: string) => formatMoney(amount, detail.currency, locale);
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });

  async function unmatch(item: PayoutItemDTO) {
    if (!activeStudioId) return;
    setBusyId(item.id);
    setError(null);
    try {
      onChange(await bffFetch<PayoutDetailDTO>(`studios/${activeStudioId}/payouts/${detail.id}/items/${item.id}/match`, { method: 'DELETE', studioId: activeStudioId }));
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('payouts.errors.unmatchFailed'));
    } finally {
      setBusyId(null);
    }
  }

  const summary: { label: string; value: string }[] = [
    { label: t('payouts.col.gross'), value: money(detail.grossAmount) },
    { label: t('payouts.col.fee'), value: money(detail.feeAmount) },
    { label: t('payouts.col.refund'), value: money(detail.refundAmount) },
    { label: t('payouts.col.net'), value: money(detail.netAmount) },
  ];
  const differs = Number(detail.netDifference) !== 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('payouts.detail.title', { id: detail.providerPayoutId })}
          </h3>
          <p className="text-xs mt-0.5 flex flex-wrap items-center gap-2" style={{ color: 'var(--color-text-secondary)' }}>
            <span>{t(`payouts.provider.${detail.provider}`)}</span>
            <span>{t('payouts.detail.arrival', { date: day.format(new Date(detail.arrivalDate)) })}</span>
            <Badge tone={PAYOUT_STATUS_TONE[detail.status]}>{t(`payouts.status.${detail.status}`)}</Badge>
            <Badge tone={RECONCILIATION_TONE[detail.reconciliationStatus]}>{t(`payouts.reconciliation.${detail.reconciliationStatus}`)}</Badge>
          </p>
        </div>
        <PermissionButton variant="secondary" onClick={onBack}>
          {t('payouts.detail.back')}
        </PermissionButton>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summary.map((s) => (
          <div key={s.label} className="p-3" style={cardStyle}>
            <dt className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {s.label}
            </dt>
            <dd className="text-base font-semibold mt-1" style={{ color: 'var(--color-text-primary)' }}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-xs" role="status" style={{ color: differs ? '#b45309' : 'var(--color-text-secondary)' }}>
        {differs ? t('payouts.detail.netDifference', { amount: money(detail.netDifference) }) : t('payouts.detail.balanced')}
      </p>

      <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {t('payouts.detail.itemsTitle')}
      </h4>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {detail.items.length === 0 ? (
        <EmptyState title={t('payouts.detail.noItems')} />
      ) : (
        <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {[t('payouts.col.type'), t('payouts.col.providerReference'), t('payouts.col.occurredAt'), t('payouts.col.amount'), t('payouts.col.fee'), t('payouts.col.net'), t('payouts.col.payment'), ''].map((h, i) => (
                  <th key={i} className="text-left px-3 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={item.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <Badge tone={item.type === 'CHARGE' ? 'success' : item.type === 'REFUND' ? 'warning' : 'neutral'}>{t(`payouts.itemType.${item.type}`)}</Badge>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs break-all" style={{ color: 'var(--color-text-secondary)' }}>
                    {item.providerReference ?? '-'}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {dateTime.format(new Date(item.occurredAt))}
                  </td>
                  <td className="px-3 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {money(item.amount)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {Number(item.fee) > 0 ? money(item.fee) : '-'}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {money(item.net)}
                  </td>
                  <td className="px-3 py-2.5">
                    {item.payment ? (
                      <div>
                        <p style={{ color: 'var(--color-text-primary)' }}>
                          {item.payment.receiptNumber ?? t('payouts.item.noReceipt')} - {formatMoney(item.payment.amount, item.payment.currency, locale)}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {dateTime.format(new Date(item.payment.paidAt))}
                          {item.matchSource ? ` - ${t(`payouts.matchSource.${item.matchSource}`)}` : ''}
                        </p>
                      </div>
                    ) : MATCHABLE.has(item.type) ? (
                      <Badge tone="danger">{t('payouts.item.unmatched')}</Badge>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {t('payouts.item.notMatchable')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {MATCHABLE.has(item.type) && (
                      <span className="inline-flex gap-2">
                        <PermissionButton required={['payouts.manage']} variant="secondary" onClick={() => setMatching(item)}>
                          {t('payouts.item.match')}
                        </PermissionButton>
                        {item.payment && (
                          <PermissionButton required={['payouts.manage']} variant="danger" disabled={busyId === item.id} onClick={() => unmatch(item)}>
                            {t('payouts.item.unmatch')}
                          </PermissionButton>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {matching && activeStudioId && (
        <PayoutMatchDialog
          studioId={activeStudioId}
          payoutId={detail.id}
          item={matching}
          onClose={() => setMatching(null)}
          onDone={(next) => {
            setMatching(null);
            onChange(next);
          }}
        />
      )}
    </div>
  );
}
