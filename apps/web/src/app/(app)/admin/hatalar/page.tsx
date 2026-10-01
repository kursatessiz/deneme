'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ERROR_GROUP_STATUSES, ERROR_SOURCES } from '@platform/shared';
import type { ErrorGroupListDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LinkButton } from '@/components/ui/LinkButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';


interface Filters {
  q: string;
  source: string;
  status: string;
  release: string;
  studioId: string;
}
const EMPTY: Filters = { q: '', source: '', status: '', release: '', studioId: '' };

function toQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim());
  params.set('page', String(page));
  return params.toString();
}

/** Super admin: every error group, filterable, searchable by error code (docs/HATA_RAPORLAMA.md). */
export default function AdminErrorsPage() {
  const t = useT();
  const locale = useLocale();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const { data, loading, error, forbidden } = useBff<ErrorGroupListDTO>(`admin/errors?${toQuery(filters, page)}`, null);

  if (forbidden) return <EmptyState title={t('adminErrors.accessDenied')} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setFilters(draft);
  };
  const field = (key: keyof Filters) => ({ value: draft[key], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft({ ...draft, [key]: e.target.value }) });

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('adminErrors.title')}
        description={t('adminErrors.subtitle')}
        actions={
          <nav aria-label={t('adminErrors.title')} className="flex gap-2">
            <LinkButton href="/admin/hatalar/uyarilar" variant="outline" tone="surface" size="sm">
              {t('adminErrors.tabs.alerts')}
            </LinkButton>
            <LinkButton href="/admin/hatalar/ayarlar" variant="outline" tone="surface" size="sm">
              {t('adminErrors.tabs.settings')}
            </LinkButton>
          </nav>
        }
      />

      <form onSubmit={apply} className="flex flex-wrap items-end gap-3" role="search">
        <Input aria-label={t('adminErrors.filter.search')} placeholder={t('adminErrors.filter.search')} className="w-56" {...field('q')} />
        <Select aria-label={t('adminErrors.filter.source')} className="w-auto" {...field('source')}>
          <option value="">{`${t('adminErrors.filter.source')}: ${t('adminErrors.filter.all')}`}</option>
          {ERROR_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`errors.source.${s}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('adminErrors.filter.status')} className="w-auto" {...field('status')}>
          <option value="">{`${t('adminErrors.filter.status')}: ${t('adminErrors.filter.all')}`}</option>
          {ERROR_GROUP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`errors.status.${s}`)}
            </option>
          ))}
        </Select>
        <Input aria-label={t('adminErrors.filter.release')} placeholder={t('adminErrors.filter.release')} className="w-36" {...field('release')} />
        <Input aria-label={t('adminErrors.filter.studio')} placeholder={t('adminErrors.filter.studio')} className="w-72" {...field('studioId')} />
        <Button type="submit">{t('adminErrors.filter.apply')}</Button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && data.items.length === 0 && <EmptyState title={t('adminErrors.empty')} />}
      {data && data.items.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  {(['title', 'source', 'status', 'count', 'studios', 'users', 'lastSeen', 'release'] as const).map((col) => (
                    <Th key={col}>{t(`adminErrors.col.${col}`)}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {data.items.map((g) => (
                  <Tr key={g.id} className="align-top">
                    <Td>
                      <Link href={`/admin/hatalar/${g.id}`} className="pui-link pui-surface ui-strong break-all">
                        {g.title}
                      </Link>
                      <span className="block ui-caption">
                        {g.lastCode ? `${t('adminErrors.detail.code')}: ${g.lastCode}` : ''}
                        {g.critical ? ` - ${t('adminErrors.critical')}` : ''}
                      </span>
                    </Td>
                    <Td>{t(`errors.source.${g.source}`)}</Td>
                    <Td>{t(`errors.status.${g.status}`)}</Td>
                    <Td className="tabular-nums">{new Intl.NumberFormat(locale).format(g.count)}</Td>
                    <Td className="tabular-nums">{g.affectedStudioCount}</Td>
                    <Td className="tabular-nums">{g.affectedUserCount}</Td>
                    <Td className="whitespace-nowrap">{dateTime.format(new Date(g.lastSeenAt))}</Td>
                    <Td className="ui-mono">{g.lastRelease ?? ''}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Card>
          <div className="flex items-center gap-3">
            <Button variant="outline" tone="surface" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('adminErrors.page.previous')}
            </Button>
            <span className="ui-text-muted">{t('adminErrors.page.info', { page, pages, total: data.total })}</span>
            <Button variant="outline" tone="surface" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t('adminErrors.page.next')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
