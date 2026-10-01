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
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';

const MATCHABLE = new Set(['CHARGE', 'REFUND']);

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
      onChange(
        await bffFetch<PayoutDetailDTO>(`studios/${activeStudioId}/payouts/${detail.id}/items/${item.id}/match`, {
          method: 'DELETE',
          studioId: activeStudioId,
        }),
      );
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
          <h3 className="ui-heading">{t('payouts.detail.title', { id: detail.providerPayoutId })}</h3>
          <p className="ui-caption mt-0.5 flex flex-wrap items-center gap-2">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summary.map((s) => (
          <StatTile key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      <p className="ui-caption" role="status">
        {differs ? t('payouts.detail.netDifference', { amount: money(detail.netDifference) }) : t('payouts.detail.balanced')}
      </p>

      <h4 className="ui-heading">{t('payouts.detail.itemsTitle')}</h4>
      {error && <p className="ui-caption ui-text-error">{error}</p>}
      {detail.items.length === 0 ? (
        <EmptyState title={t('payouts.detail.noItems')} />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {[
                  t('payouts.col.type'),
                  t('payouts.col.providerReference'),
                  t('payouts.col.occurredAt'),
                  t('payouts.col.amount'),
                  t('payouts.col.fee'),
                  t('payouts.col.net'),
                  t('payouts.col.payment'),
                  '',
                ].map((h, i) => (
                  <Th key={i} className="whitespace-nowrap">
                    {h}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {detail.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="whitespace-nowrap">
                    <Badge tone={item.type === 'CHARGE' ? 'success' : item.type === 'REFUND' ? 'warning' : 'neutral'}>
                      {t(`payouts.itemType.${item.type}`)}
                    </Badge>
                  </Td>
                  <Td className="font-mono ui-caption break-all">{item.providerReference ?? '-'}</Td>
                  <Td className="whitespace-nowrap">{dateTime.format(new Date(item.occurredAt))}</Td>
                  <Td className="ui-strong whitespace-nowrap">{money(item.amount)}</Td>
                  <Td className="whitespace-nowrap">{Number(item.fee) > 0 ? money(item.fee) : '-'}</Td>
                  <Td className="whitespace-nowrap">{money(item.net)}</Td>
                  <Td>
                    {item.payment ? (
                      <div>
                        <p>
                          {item.payment.receiptNumber ?? t('payouts.item.noReceipt')} - {formatMoney(item.payment.amount, item.payment.currency, locale)}
                        </p>
                        <p className="ui-caption">
                          {dateTime.format(new Date(item.payment.paidAt))}
                          {item.matchSource ? ` - ${t(`payouts.matchSource.${item.matchSource}`)}` : ''}
                        </p>
                      </div>
                    ) : MATCHABLE.has(item.type) ? (
                      <Badge tone="danger">{t('payouts.item.unmatched')}</Badge>
                    ) : (
                      <span className="ui-caption">{t('payouts.item.notMatchable')}</span>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
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
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
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
