'use client';

import { useState } from 'react';
import type { AuditLogListDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';

const PAGE_SIZE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Filters {
  userId: string;
  action: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { userId: '', action: '', from: '', to: '' };

/** Query string of the filters; `from`/`to` are dates (UTC day boundaries), invalid user ids are left out and reported by the form. */
function toQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (UUID_RE.test(filters.userId.trim())) params.set('userId', filters.userId.trim());
  if (filters.action.trim()) params.set('action', filters.action.trim());
  if (filters.from) params.set('from', `${filters.from}T00:00:00.000Z`);
  if (filters.to) params.set('to', `${filters.to}T23:59:59.999Z`);
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  return params.toString();
}

/**
 * Super admin audit view (M3d, docs/PAZARLAMA_MODULU.md 6.3): AuditLog rows
 * of every tenant, newest first, filterable by user, action and period, with
 * pages. The metadata column is the API's short redacted summary.
 */
export default function AdminAuditPage() {
  const t = useT();
  const locale = useLocale();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const userInvalid = draft.userId.trim() !== '' && !UUID_RE.test(draft.userId.trim());
  const rangeInvalid = draft.from !== '' && draft.to !== '' && draft.from > draft.to;
  const { data, loading, error, forbidden } = useBff<AuditLogListDTO>(`admin/audit?${toQuery(filters, page)}`, null);

  if (forbidden) return <EmptyState title={t('adminAudit.accessDenied')} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    if (userInvalid || rangeInvalid) return;
    setPage(1);
    setFilters(draft);
  };
  const clear = () => {
    setDraft(EMPTY);
    setFilters(EMPTY);
    setPage(1);
  };
  const field = (key: keyof Filters) => ({ value: draft[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: e.target.value }) });

  return (
    <div className="grid gap-6">
      <PageHeader title={t('adminAudit.title')} description={t('adminAudit.subtitle')} />

      <form onSubmit={apply} className="flex flex-wrap items-end gap-3" role="search">
        <FieldGroup label={t('adminAudit.filter.user')}>
          <Input invalid={userInvalid} placeholder={t('adminAudit.filter.userPlaceholder')} className="w-80 ui-mono" {...field('userId')} />
        </FieldGroup>
        <FieldGroup label={t('adminAudit.filter.action')}>
          <Input placeholder={t('adminAudit.filter.actionPlaceholder')} className="w-64" {...field('action')} />
        </FieldGroup>
        <FieldGroup label={t('adminAudit.filter.from')}>
          <Input type="date" {...field('from')} />
        </FieldGroup>
        <FieldGroup label={t('adminAudit.filter.to')}>
          <Input type="date" {...field('to')} />
        </FieldGroup>
        <Button type="submit">{t('adminAudit.filter.apply')}</Button>
        <Button variant="outline" tone="surface" onClick={clear}>
          {t('adminAudit.filter.clear')}
        </Button>
      </form>
      {userInvalid && (
        <p role="alert" className="ui-caption ui-text-error">
          {t('adminAudit.filter.userInvalid')}
        </p>
      )}
      {rangeInvalid && (
        <p role="alert" className="ui-caption ui-text-error">
          {t('adminAudit.filter.rangeInvalid')}
        </p>
      )}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && data.items.length === 0 && <EmptyState title={t('adminAudit.empty')} />}
      {data && data.items.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  {(['time', 'user', 'action', 'target', 'details'] as const).map((col) => (
                    <Th key={col}>{t(`adminAudit.col.${col}`)}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {data.items.map((row) => (
                  <Tr key={row.id} className="align-top">
                    <Td className="whitespace-nowrap">{dateTime.format(new Date(row.createdAt))}</Td>
                    <Td>{row.userName ?? (row.userId ? t('adminAudit.unknownUser') : t('adminAudit.system'))}</Td>
                    <Td className="ui-mono break-all">{row.action}</Td>
                    <Td className="ui-small">
                      <span className="block">{row.entityType}</span>
                      {row.entityId && <span className="block ui-mono ui-text-muted break-all">{row.entityId}</span>}
                    </Td>
                    <Td className="ui-small ui-text-muted break-words">{row.metadataSummary}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Card>
          <div className="flex items-center gap-3">
            <Button variant="outline" tone="surface" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('adminAudit.page.previous')}
            </Button>
            <span className="ui-text-muted">{t('adminAudit.page.info', { page, pages, total: data.total })}</span>
            <Button variant="outline" tone="surface" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t('adminAudit.page.next')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
