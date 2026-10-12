'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ERASURE_REQUEST_STATUSES, type ErasureRequestDTO, type ErasureRequestStatus } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { useConfirm, useToast } from '@/components/ui';

const STATUS_TONE: Record<ErasureRequestStatus, 'warning' | 'info' | 'danger' | 'success'> = {
  PENDING: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  COMPLETED: 'success',
};

function ErasureRequests() {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const { confirm, prompt } = useConfirm();
  const toast = useToast();
  const [status, setStatus] = useState<'' | ErasureRequestStatus>('');
  const [rows, setRows] = useState<ErasureRequestDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!activeStudioId) return;
    setError(null);
    bffFetch<ErasureRequestDTO[]>(`studios/${activeStudioId}/erasure-requests${status ? `?status=${status}` : ''}`, { studioId: activeStudioId })
      .then(setRows)
      .catch((err) => setError(err instanceof BffError ? err.message : t('erasure.errors.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, status]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function decide(row: ErasureRequestDTO, decision: 'approve' | 'reject') {
    let body: { note?: string } = {};
    if (decision === 'approve') {
      if (!(await confirm({ message: t('erasure.list.approveConfirm'), confirmLabel: t('erasure.list.approveConfirmLabel'), danger: true }))) return;
    } else {
      const note = await prompt({ message: t('erasure.list.rejectConfirm'), confirmLabel: t('erasure.list.rejectConfirmLabel'), inputLabel: t('erasure.list.rejectReasonLabel') });
      if (note === null) return;
      if (note.trim()) body = { note: note.trim() };
    }
    setBusyId(row.id);
    try {
      await bffFetch(`studios/${activeStudioId}/erasure-requests/${row.id}/${decision}`, { method: 'POST', studioId: activeStudioId, body });
      toast.show(decision === 'approve' ? t('erasure.list.approved') : t('erasure.list.rejected'), 'success');
      load();
    } catch (err) {
      toast.error(err instanceof BffError ? err.message : t('erasure.errors.actionFailed'));
    } finally {
      setBusyId(null);
    }
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/members" className="pui-link pui-surface inline-flex items-center gap-1">
          <ArrowLeft className="ui-icon" aria-hidden="true" />
          {t('erasure.list.back')}
        </Link>
      </div>
      <PageHeader title={t('erasure.list.title')} description={t('erasure.list.subtitle')} />

      <div className="flex flex-wrap gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value as '' | ErasureRequestStatus)} aria-label={t('erasure.list.col.status')}>
          <option value="">{t('erasure.list.filter.all')}</option>
          {ERASURE_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`erasure.status.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!rows || rows.length === 0) && <EmptyState title={t('erasure.list.empty.title')} description={t('erasure.list.empty.description')} />}
      {!loading && !error && rows && rows.length > 0 && (
        <div className="pui-card overflow-x-auto">
          <Table hoverable>
            <Thead>
              <Tr>
                <Th>{t('erasure.list.col.member')}</Th>
                <Th>{t('erasure.list.col.requestedAt')}</Th>
                <Th>{t('erasure.list.col.dueAt')}</Th>
                <Th>{t('erasure.list.col.source')}</Th>
                <Th>{t('erasure.list.col.status')}</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    {row.memberProfileId && row.memberName ? (
                      <Link href={`/members/${row.memberProfileId}`} className="pui-link pui-surface">
                        {row.memberName}
                      </Link>
                    ) : (
                      <span className="ui-text-muted">{t('erasure.erasedMember')}</span>
                    )}
                  </Td>
                  <Td className="ui-text-muted">{date(row.requestedAt)}</Td>
                  <Td className="ui-text-muted">{date(row.dueAt)}</Td>
                  <Td>{t(`erasure.source.${row.source}`)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[row.status]}>{t(`erasure.status.${row.status}`)}</Badge>
                  </Td>
                  <Td style={{ textAlign: 'end' }}>
                    {row.status === 'PENDING' && (
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        <PermissionButton required={['members.erase']} variant="primary" disabled={busyId === row.id} onClick={() => decide(row, 'approve')}>
                          {t('erasure.list.approve')}
                        </PermissionButton>
                        <Button variant="outline" tone="surface" size="sm" disabled={busyId === row.id} onClick={() => decide(row, 'reject')}>
                          {t('erasure.list.reject')}
                        </Button>
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function ErasureRequestsPage() {
  return (
    <PageGuard required={['members.erase']}>
      <ErasureRequests />
    </PageGuard>
  );
}
