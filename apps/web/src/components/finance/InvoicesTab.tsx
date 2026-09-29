'use client';

import { useEffect, useState } from 'react';
import { InvoiceStatus } from '@platform/shared';
import type { InvoiceDTO } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { buildReportQuery } from '@/lib/reports/query';
import { formatMoney } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { BranchSelect } from '@/components/common/BranchSelect';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';

type InvoiceRow = InvoiceDTO;

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ISSUED: 'success',
  DRAFT: 'neutral',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

const selectStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export function InvoicesTab() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const statusLabel = (s: string) => t(`finance.invoiceStatus.${s}`);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(buildReportQuery({ from, to, branchId: branchId || null }));
    if (status) params.set('status', status);
    const qs = params.toString();
    bffFetch<InvoiceRow[]>(`invoices${qs ? `?${qs}` : ''}`, { studioId: activeStudioId })
      .then(setInvoices)
      .catch((err) => setError(err instanceof BffError ? err.message : t('finance.invoices.errors.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, branchId, status, from, to, reloadKey]);

  async function handleRetry(id: string) {
    if (!activeStudioId) return;
    setRetryingId(id);
    try {
      await bffFetch(`invoices/${id}/retry`, { method: 'POST', studioId: activeStudioId });
      setReloadKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : t('finance.invoices.errors.retryFailed'));
    } finally {
      setRetryingId(null);
    }
  }

  const exportHref = `/api/bff/invoices/export${(() => {
    const params = new URLSearchParams(buildReportQuery({ from, to, branchId: branchId || null }));
    if (status) params.set('status', status);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  })()}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter
            from={from}
            to={to}
            onChange={({ from: f, to: t2 }) => {
              setFrom(f);
              setTo(t2);
            }}
          />
          <BranchSelect value={branchId} onChange={setBranchId} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-xs px-2.5 py-1.5" style={selectStyle}>
            <option value="">{t('finance.invoices.allStatuses')}</option>
            {Object.values(InvoiceStatus).map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <a href={exportHref} className="text-xs font-medium px-3 py-1.5" style={{ ...selectStyle, background: 'var(--color-surface-muted)' }}>
          {t('finance.invoices.downloadCsv')}
        </a>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!invoices || invoices.length === 0) && (
        <EmptyState title={t('finance.invoices.empty.title')} description={t('finance.invoices.empty.description')} />
      )}
      {!loading && !error && invoices && invoices.length > 0 && (
        <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {[
                  t('finance.invoices.col.number'),
                  t('finance.invoices.col.date'),
                  t('finance.invoices.col.amount'),
                  t('finance.invoices.col.status'),
                  '',
                ].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {inv.number}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {new Date(inv.issueDate).toLocaleDateString(locale)}
                  </td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {formatMoney(inv.total)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[inv.status] ?? 'neutral'}>{statusLabel(inv.status)}</Badge>
                    {inv.status === 'FAILED' && inv.failureReason && (
                      <span className="block text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {inv.failureReason}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {inv.status === 'FAILED' && (
                      <PermissionButton required={['finance.manage']} onClick={() => handleRetry(inv.id)} disabled={retryingId === inv.id}>
                        {retryingId === inv.id ? t('finance.invoices.retrying') : t('finance.invoices.retry')}
                      </PermissionButton>
                    )}
                    <a
                      href={`/api/bff/invoices/${inv.id}/download`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 text-xs hover:underline"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {t('finance.invoices.download')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
