'use client';

import { useEffect, useState } from 'react';
import { STOCK_MOVEMENT_TYPES } from '@platform/shared';
import type { StockMovementDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { retailErrorMessage } from '@/lib/retail/errors';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { BranchSelect } from '@/components/common/BranchSelect';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Card, Select, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';

const PAGE_SIZE = 50;

/** The append-only stock ledger, newest first. */
export function MovementsTab() {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const [branchId, setBranchId] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: StockMovementDTO[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (branchId) params.set('branchId', branchId);
    if (type) params.set('type', type);
    bffFetch<{ items: StockMovementDTO[]; total: number }>(`studios/${activeStudioId}/retail/stock/movements?${params.toString()}`, { studioId: activeStudioId })
      .then(setData)
      .catch((err) => setError(retailErrorMessage(t, err, 'retail.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, branchId, type, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BranchSelect
          value={branchId}
          onChange={(v) => {
            setBranchId(v);
            setPage(1);
          }}
        />
        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          aria-label={t('retail.movements.col.type')}
        >
          <option value="">{t('retail.movements.allTypes')}</option>
          {STOCK_MOVEMENT_TYPES.map((m) => (
            <option key={m} value={m}>
              {t(`retail.movement.${m}`)}
            </option>
          ))}
        </Select>
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState title={t('retail.movements.empty.title')} description={t('retail.movements.empty.description')} />
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {(['date', 'product', 'branch', 'type', 'quantity', 'after', 'reason', 'actor'] as const).map((c) => (
                  <Th key={c} className="whitespace-nowrap">
                    {t(`retail.movements.col.${c}`)}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((m) => (
                <Tr key={m.id}>
                  <Td className="whitespace-nowrap">{new Date(m.createdAt).toLocaleString(locale)}</Td>
                  <Td>{m.productName}</Td>
                  <Td>{m.branchName}</Td>
                  <Td>{t(`retail.movement.${m.type}`)}</Td>
                  <Td className={m.quantity < 0 ? 'ui-strong ui-text-error' : 'ui-strong'}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</Td>
                  <Td>{m.quantityAfter}</Td>
                  <Td>{[m.reason, m.reference].filter(Boolean).join(' - ') || '-'}</Td>
                  <Td>{m.actorName ?? '-'}</Td>
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
