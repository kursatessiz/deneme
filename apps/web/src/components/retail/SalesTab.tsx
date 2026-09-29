'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SALE_STATUSES } from '@platform/shared';
import type { SaleListItemDTO, SaleStatus } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { buildReportQuery } from '@/lib/reports/query';
import { retailErrorMessage } from '@/lib/retail/errors';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { BranchSelect } from '@/components/common/BranchSelect';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { Badge } from '@/components/common/Badge';
import { PermissionButton } from '@/components/common/PermissionButton';
import { fieldStyle, headRowStyle, labelStyle, rowStyle, tableWrapStyle } from './styles';

const PAGE_SIZE = 50;

export const SALE_STATUS_TONE: Record<SaleStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  COMPLETED: 'success',
  PARTIALLY_REFUNDED: 'warning',
  REFUNDED: 'neutral',
  VOID: 'danger',
};

/** Sales history with filters; each row opens the receipt, where refunds happen. */
export function SalesTab() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [receipt, setReceipt] = useState('');
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: SaleListItemDTO[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(buildReportQuery({ from, to, branchId: branchId || null }));
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    if (status) params.set('status', status);
    if (receipt.trim()) params.set('receipt', receipt.trim());
    bffFetch<{ items: SaleListItemDTO[]; total: number }>(`studios/${activeStudioId}/retail/sales?${params.toString()}`, { studioId: activeStudioId })
      .then(setData)
      .catch((err) => setError(retailErrorMessage(t, err, 'retail.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, branchId, status, receipt, from, to, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeFilter
          from={from}
          to={to}
          onChange={({ from: f, to: t2 }) => {
            setFrom(f);
            setTo(t2);
            setPage(1);
          }}
        />
        <BranchSelect
          value={branchId}
          onChange={(v) => {
            setBranchId(v);
            setPage(1);
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="text-xs px-2.5 py-1.5"
          style={fieldStyle}
          aria-label={t('retail.sales.col.status')}
        >
          <option value="">{t('retail.sales.allStatuses')}</option>
          {SALE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`retail.status.${s}`)}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label={t('retail.sales.receiptSearch')}
          placeholder={t('retail.sales.receiptSearch')}
          value={receipt}
          onChange={(e) => {
            setReceipt(e.target.value);
            setPage(1);
          }}
          className="text-xs px-2.5 py-1.5"
          style={fieldStyle}
        />
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState
          title={t('retail.sales.empty.title')}
          description={t('retail.sales.empty.description')}
          action={{ labelKey: 'retail.quickSaleLink', href: '/magaza/satis', permissions: ['retail.sell'] }}
        />
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <div className="border overflow-x-auto" style={tableWrapStyle}>
          <table className="w-full text-sm" data-testid="retail-sales">
            <thead>
              <tr style={headRowStyle}>
                {(['receipt', 'date', 'customer', 'items', 'total', 'method', 'status'] as const).map((c) => (
                  <th key={c} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={labelStyle}>
                    {t(`retail.sales.col.${c}`)}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="border-t" style={rowStyle}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {s.receiptNumber}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={labelStyle}>
                    {new Date(s.createdAt).toLocaleString(locale)}
                  </td>
                  <td className="px-4 py-2.5" style={labelStyle}>
                    {s.customerName ?? t('retail.sales.walkIn')}
                  </td>
                  <td className="px-4 py-2.5" style={labelStyle}>
                    {s.itemCount}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {formatMoney(s.total)}
                  </td>
                  <td className="px-4 py-2.5" style={labelStyle}>
                    {t(`retail.method.${s.paymentMethod}`)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={SALE_STATUS_TONE[s.status]}>{t(`retail.status.${s.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/magaza/satislar/${s.id}`} className="text-xs font-medium hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
                      {t('retail.sales.open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex justify-end gap-2">
          <PermissionButton variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('retail.sales.previous')}
          </PermissionButton>
          <PermissionButton variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('retail.sales.next')}
          </PermissionButton>
        </div>
      )}
    </div>
  );
}
