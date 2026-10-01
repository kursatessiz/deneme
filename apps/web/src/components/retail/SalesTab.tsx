'use client';

import { useEffect, useState } from 'react';
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
import { Card, Input, LinkButton, Select, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';

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
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label={t('retail.sales.col.status')}
        >
          <option value="">{t('retail.sales.allStatuses')}</option>
          {SALE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`retail.status.${s}`)}
            </option>
          ))}
        </Select>
        <Input
          type="search"
          aria-label={t('retail.sales.receiptSearch')}
          placeholder={t('retail.sales.receiptSearch')}
          value={receipt}
          onChange={(e) => {
            setReceipt(e.target.value);
            setPage(1);
          }}
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
        <Card className="overflow-x-auto">
          <Table data-testid="retail-sales">
            <Thead>
              <Tr>
                {(['receipt', 'date', 'customer', 'items', 'total', 'method', 'status'] as const).map((c) => (
                  <Th key={c} className="whitespace-nowrap">
                    {t(`retail.sales.col.${c}`)}
                  </Th>
                ))}
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((s) => (
                <Tr key={s.id}>
                  <Td className="ui-strong">{s.receiptNumber}</Td>
                  <Td className="whitespace-nowrap">{new Date(s.createdAt).toLocaleString(locale)}</Td>
                  <Td>{s.customerName ?? t('retail.sales.walkIn')}</Td>
                  <Td>{s.itemCount}</Td>
                  <Td className="whitespace-nowrap ui-strong">{formatMoney(s.total)}</Td>
                  <Td>{t(`retail.method.${s.paymentMethod}`)}</Td>
                  <Td>
                    <Badge tone={SALE_STATUS_TONE[s.status]}>{t(`retail.status.${s.status}`)}</Badge>
                  </Td>
                  <Td className="text-right">
                    <LinkButton href={`/magaza/satislar/${s.id}`} variant="link" tone="surface" size="sm">
                      {t('retail.sales.open')}
                    </LinkButton>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
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
