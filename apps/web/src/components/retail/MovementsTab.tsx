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
import { fieldStyle, headRowStyle, labelStyle, rowStyle, tableWrapStyle } from './styles';

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
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="text-xs px-2.5 py-1.5"
          style={fieldStyle}
          aria-label={t('retail.movements.col.type')}
        >
          <option value="">{t('retail.movements.allTypes')}</option>
          {STOCK_MOVEMENT_TYPES.map((m) => (
            <option key={m} value={m}>
              {t(`retail.movement.${m}`)}
            </option>
          ))}
        </select>
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState title={t('retail.movements.empty.title')} description={t('retail.movements.empty.description')} />
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <div className="border overflow-x-auto" style={tableWrapStyle}>
          <table className="w-full text-sm">
            <thead>
              <tr style={headRowStyle}>
                {(['date', 'product', 'branch', 'type', 'quantity', 'after', 'reason', 'actor'] as const).map((c) => (
                  <th key={c} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={labelStyle}>
                    {t(`retail.movements.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((m) => (
                <tr key={m.id} className="border-t" style={rowStyle}>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={labelStyle}>
                    {new Date(m.createdAt).toLocaleString(locale)}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-primary)' }}>
                    {m.productName}
                  </td>
                  <td className="px-4 py-2.5" style={labelStyle}>
                    {m.branchName}
                  </td>
                  <td className="px-4 py-2.5" style={labelStyle}>
                    {t(`retail.movement.${m.type}`)}
                  </td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: m.quantity < 0 ? 'var(--color-danger, #b42318)' : 'var(--color-text-primary)' }}>
                    {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-primary)' }}>
                    {m.quantityAfter}
                  </td>
                  <td className="px-4 py-2.5" style={labelStyle}>
                    {[m.reason, m.reference].filter(Boolean).join(' - ') || '-'}
                  </td>
                  <td className="px-4 py-2.5" style={labelStyle}>
                    {m.actorName ?? '-'}
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
