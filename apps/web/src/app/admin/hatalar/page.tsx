'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ERROR_GROUP_STATUSES, ERROR_SOURCES } from '@platform/shared';
import type { ErrorGroupListDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};
const card: React.CSSProperties = { borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' };

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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('adminErrors.title')}</h2>
        <nav aria-label={t('adminErrors.title')} className="flex gap-4 text-sm mt-2">
          <Link href="/admin/hatalar/uyarilar" className="hover:underline">
            {t('adminErrors.tabs.alerts')}
          </Link>
          <Link href="/admin/hatalar/ayarlar" className="hover:underline">
            {t('adminErrors.tabs.settings')}
          </Link>
        </nav>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminErrors.subtitle')}
        </p>
      </div>

      <form onSubmit={apply} className="flex flex-wrap items-end gap-3" role="search">
        <input aria-label={t('adminErrors.filter.search')} placeholder={t('adminErrors.filter.search')} className="border px-3 py-2 text-sm w-56" style={inputStyle} {...field('q')} />
        <select aria-label={t('adminErrors.filter.source')} className="border px-3 py-2 text-sm" style={inputStyle} {...field('source')}>
          <option value="">{`${t('adminErrors.filter.source')}: ${t('adminErrors.filter.all')}`}</option>
          {ERROR_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`errors.source.${s}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('adminErrors.filter.status')} className="border px-3 py-2 text-sm" style={inputStyle} {...field('status')}>
          <option value="">{`${t('adminErrors.filter.status')}: ${t('adminErrors.filter.all')}`}</option>
          {ERROR_GROUP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`errors.status.${s}`)}
            </option>
          ))}
        </select>
        <input aria-label={t('adminErrors.filter.release')} placeholder={t('adminErrors.filter.release')} className="border px-3 py-2 text-sm w-36" style={inputStyle} {...field('release')} />
        <input aria-label={t('adminErrors.filter.studio')} placeholder={t('adminErrors.filter.studio')} className="border px-3 py-2 text-sm w-72" style={inputStyle} {...field('studioId')} />
        <button type="submit" className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {t('adminErrors.filter.apply')}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && data.items.length === 0 && <EmptyState title={t('adminErrors.empty')} />}
      {data && data.items.length > 0 && (
        <>
          <div className="overflow-x-auto border" style={card}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                  {(['title', 'source', 'status', 'count', 'studios', 'users', 'lastSeen', 'release'] as const).map((col) => (
                    <th key={col} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                      {t(`adminErrors.col.${col}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((g) => (
                  <tr key={g.id} className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2">
                      <Link href={`/admin/hatalar/${g.id}`} className="font-medium hover:underline break-all">
                        {g.title}
                      </Link>
                      <span className="block text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {g.lastCode ? `${t('adminErrors.detail.code')}: ${g.lastCode}` : ''}
                        {g.critical ? ` - ${t('adminErrors.critical')}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2">{t(`errors.source.${g.source}`)}</td>
                    <td className="px-3 py-2">{t(`errors.status.${g.status}`)}</td>
                    <td className="px-3 py-2 tabular-nums">{new Intl.NumberFormat(locale).format(g.count)}</td>
                    <td className="px-3 py-2 tabular-nums">{g.affectedStudioCount}</td>
                    <td className="px-3 py-2 tabular-nums">{g.affectedUserCount}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dateTime.format(new Date(g.lastSeenAt))}</td>
                    <td className="px-3 py-2 font-mono text-xs">{g.lastRelease ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 border disabled:opacity-40" style={inputStyle}>
              {t('adminErrors.page.previous')}
            </button>
            <span style={{ color: 'var(--color-text-secondary)' }}>{t('adminErrors.page.info', { page, pages, total: data.total })}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 border disabled:opacity-40" style={inputStyle}>
              {t('adminErrors.page.next')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
