'use client';

import { useState } from 'react';
import type { AuditLogListDTO } from '@platform/shared';
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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('adminAudit.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminAudit.subtitle')}
        </p>
      </div>

      <form onSubmit={apply} className="flex flex-wrap items-end gap-3" role="search">
        <label className="text-xs space-y-1">
          <span style={{ color: 'var(--color-text-secondary)' }}>{t('adminAudit.filter.user')}</span>
          <input
            aria-invalid={userInvalid}
            placeholder={t('adminAudit.filter.userPlaceholder')}
            className="block border px-3 py-2 text-sm w-80 font-mono"
            style={{ ...inputStyle, ...(userInvalid ? { borderColor: 'var(--color-danger)' } : {}) }}
            {...field('userId')}
          />
        </label>
        <label className="text-xs space-y-1">
          <span style={{ color: 'var(--color-text-secondary)' }}>{t('adminAudit.filter.action')}</span>
          <input placeholder={t('adminAudit.filter.actionPlaceholder')} className="block border px-3 py-2 text-sm w-64" style={inputStyle} {...field('action')} />
        </label>
        <label className="text-xs space-y-1">
          <span style={{ color: 'var(--color-text-secondary)' }}>{t('adminAudit.filter.from')}</span>
          <input type="date" className="block border px-3 py-2 text-sm" style={inputStyle} {...field('from')} />
        </label>
        <label className="text-xs space-y-1">
          <span style={{ color: 'var(--color-text-secondary)' }}>{t('adminAudit.filter.to')}</span>
          <input type="date" className="block border px-3 py-2 text-sm" style={inputStyle} {...field('to')} />
        </label>
        <button type="submit" className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {t('adminAudit.filter.apply')}
        </button>
        <button type="button" onClick={clear} className="px-4 py-2 text-sm font-medium border" style={{ ...inputStyle, borderRadius: 'var(--radius-button)' }}>
          {t('adminAudit.filter.clear')}
        </button>
      </form>
      {userInvalid && (
        <p role="alert" className="text-xs" style={{ color: 'var(--color-danger)' }}>
          {t('adminAudit.filter.userInvalid')}
        </p>
      )}
      {rangeInvalid && (
        <p role="alert" className="text-xs" style={{ color: 'var(--color-danger)' }}>
          {t('adminAudit.filter.rangeInvalid')}
        </p>
      )}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && data.items.length === 0 && <EmptyState title={t('adminAudit.empty')} />}
      {data && data.items.length > 0 && (
        <>
          <div className="overflow-x-auto border" style={card}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                  {(['time', 'user', 'action', 'target', 'details'] as const).map((col) => (
                    <th key={col} scope="col" className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                      {t(`adminAudit.col.${col}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id} className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2 whitespace-nowrap">{dateTime.format(new Date(row.createdAt))}</td>
                    <td className="px-3 py-2">{row.userName ?? (row.userId ? t('adminAudit.unknownUser') : t('adminAudit.system'))}</td>
                    <td className="px-3 py-2 font-mono text-xs break-all">{row.action}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className="block">{row.entityType}</span>
                      {row.entityId && (
                        <span className="block font-mono break-all" style={{ color: 'var(--color-text-muted)' }}>
                          {row.entityId}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs break-words" style={{ color: 'var(--color-text-secondary)' }}>
                      {row.metadataSummary}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 border disabled:opacity-40" style={inputStyle}>
              {t('adminAudit.page.previous')}
            </button>
            <span style={{ color: 'var(--color-text-secondary)' }}>{t('adminAudit.page.info', { page, pages, total: data.total })}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 border disabled:opacity-40" style={inputStyle}>
              {t('adminAudit.page.next')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
