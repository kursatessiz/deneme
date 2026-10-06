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
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { AnchorButton } from '@/components/ui/LinkButton';
import { useToast } from '@/components/ui';

type InvoiceRow = InvoiceDTO;

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ISSUED: 'success',
  DRAFT: 'neutral',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

export function InvoicesTab() {
  const t = useT();
  const toast = useToast();
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
      toast.error(err instanceof BffError ? err.message : t('finance.invoices.errors.retryFailed'));
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
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('finance.invoices.allStatuses')}</option>
            {Object.values(InvoiceStatus).map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
        <AnchorButton href={exportHref} variant="outline" tone="surface" size="sm">
          {t('finance.invoices.downloadCsv')}
        </AnchorButton>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!invoices || invoices.length === 0) && (
        <EmptyState title={t('finance.invoices.empty.title')} description={t('finance.invoices.empty.description')} />
      )}
      {!loading && !error && invoices && invoices.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {[t('finance.invoices.col.number'), t('finance.invoices.col.date'), t('finance.invoices.col.amount'), t('finance.invoices.col.status'), ''].map(
                  (h, i) => (
                    <Th key={i} className="whitespace-nowrap">
                      {h}
                    </Th>
                  ),
                )}
              </Tr>
            </Thead>
            <Tbody>
              {invoices.map((inv) => (
                <Tr key={inv.id}>
                  <Td className="whitespace-nowrap">{inv.number}</Td>
                  <Td className="whitespace-nowrap">{new Date(inv.issueDate).toLocaleDateString(locale)}</Td>
                  <Td className="ui-strong">{formatMoney(inv.total)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[inv.status] ?? 'neutral'}>{statusLabel(inv.status)}</Badge>
                    {inv.status === 'FAILED' && inv.failureReason && <span className="block ui-caption mt-0.5">{inv.failureReason}</span>}
                  </Td>
                  <Td className="text-right">
                    {inv.status === 'FAILED' && (
                      <PermissionButton required={['finance.manage']} onClick={() => handleRetry(inv.id)} disabled={retryingId === inv.id}>
                        {retryingId === inv.id ? t('finance.invoices.retrying') : t('finance.invoices.retry')}
                      </PermissionButton>
                    )}
                    <AnchorButton href={`/api/bff/invoices/${inv.id}/download`} target="_blank" rel="noreferrer" variant="link" size="sm">
                      {t('finance.invoices.download')}
                    </AnchorButton>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
