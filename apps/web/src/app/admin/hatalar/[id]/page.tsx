'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ErrorGroupDetailDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};
const card: React.CSSProperties = { borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' };
const primary: React.CSSProperties = { borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' };
const secondary: React.CSSProperties = { borderRadius: 'var(--radius-button)', borderColor: 'var(--color-border)' };

/** Super admin: one error group with its stack, breadcrumbs, releases, tenants and actions. */
export default function AdminErrorDetailPage() {
  const t = useT();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<ErrorGroupDetailDTO>(`admin/errors/${id}`, null, refreshKey);
  const [note, setNote] = useState('');
  const [release, setRelease] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setNote(data.note ?? '');
  }, [data]);

  if (forbidden) return <EmptyState title={t('adminErrors.accessDenied')} />;
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });
  const act = async (path: string, body: unknown, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await bffFetch(`admin/errors/${data.id}/${path}`, { method: path === 'note' ? 'PATCH' : 'POST', body });
      setMessage(done ?? null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage(err instanceof BffError ? err.message : t('adminErrors.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const facts: Array<[string, string]> = [
    [t('adminErrors.col.source'), t(`errors.source.${data.source}`)],
    [t('adminErrors.col.status'), t(`errors.status.${data.status}`)],
    [t('adminErrors.detail.count'), new Intl.NumberFormat(locale).format(data.count)],
    [t('adminErrors.detail.studios'), String(data.affectedStudioCount)],
    [t('adminErrors.detail.users'), String(data.affectedUserCount)],
    [t('adminErrors.detail.firstSeen'), dateTime.format(new Date(data.firstSeenAt))],
    [t('adminErrors.detail.lastSeen'), dateTime.format(new Date(data.lastSeenAt))],
    [t('adminErrors.detail.lastRelease'), data.lastRelease ?? '-'],
    [t('adminErrors.detail.resolvedIn'), data.resolvedInRelease ?? '-'],
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/hatalar" className="text-sm hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
        {t('adminErrors.detail.back')}
      </Link>
      <div>
        <h2 className="text-xl font-bold break-all">{data.title}</h2>
        {data.critical && (
          <p className="text-xs mt-1 font-medium" style={{ color: 'var(--color-danger)' }}>
            {t('adminErrors.critical')}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 p-5 border" style={card}>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {label}
            </dt>
            <dd className="text-sm font-medium break-all">{value}</dd>
          </div>
        ))}
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminErrors.detail.topFrame')}
          </dt>
          <dd className="text-xs font-mono break-all">{data.topFrame ?? '-'}</dd>
        </div>
      </dl>

      <section aria-label={t('adminErrors.detail.resolve')} className="flex flex-wrap items-center gap-3">
        {data.status !== 'RESOLVED' && (
          <>
            <input
              aria-label={t('adminErrors.detail.resolveRelease')}
              placeholder={t('adminErrors.detail.resolveRelease')}
              value={release}
              onChange={(e) => setRelease(e.target.value)}
              className="border px-3 py-2 text-sm w-80"
              style={inputStyle}
            />
            <button type="button" disabled={busy} onClick={() => act('resolve', release.trim() ? { release: release.trim() } : {})} className="px-4 py-2 text-sm font-medium" style={primary}>
              {t('adminErrors.detail.resolve')}
            </button>
          </>
        )}
        {data.status !== 'IGNORED' && (
          <button type="button" disabled={busy} onClick={() => act('ignore', {})} className="px-4 py-2 text-sm font-medium border" style={secondary}>
            {t('adminErrors.detail.ignore')}
          </button>
        )}
        {data.status !== 'OPEN' && (
          <button type="button" disabled={busy} onClick={() => act('reopen', {})} className="px-4 py-2 text-sm font-medium border" style={secondary}>
            {t('adminErrors.detail.reopen')}
          </button>
        )}
      </section>

      <section className="space-y-2">
        <label htmlFor="error-group-note" className="block text-sm font-semibold">
          {t('adminErrors.detail.note')}
        </label>
        <textarea id="error-group-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="w-full border px-3 py-2 text-sm" style={inputStyle} />
        <button type="button" disabled={busy} onClick={() => act('note', { note }, t('adminErrors.detail.noteSaved'))} className="px-4 py-2 text-sm font-medium border" style={secondary}>
          {t('adminErrors.detail.noteSave')}
        </button>
        {message && (
          <p role="status" className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {message}
          </p>
        )}
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold mb-2">{t('adminErrors.detail.releases')}</h3>
          <ul className="text-sm space-y-1">
            {data.releases.map((r) => (
              <li key={r.release} className="font-mono text-xs">
                {t('adminErrors.detail.releaseCount', { release: r.release, count: r.count })}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2">{t('adminErrors.detail.affectedStudios')}</h3>
          <ul className="text-sm space-y-1">
            {data.studios.map((s) => (
              <li key={s.studioId}>
                {s.studioName ?? s.studioId} ({s.count})
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('adminErrors.detail.events')}</h3>
        {data.events.length === 0 && <p className="text-sm">{t('adminErrors.detail.noEvents')}</p>}
        {data.events.map((e) => (
          <details key={e.id} className="border p-4" style={card}>
            <summary className="cursor-pointer text-sm">
              <span className="font-mono">{e.code}</span> - {dateTime.format(new Date(e.occurredAt))} - {e.studioName ?? t('adminErrors.detail.platform')}
            </summary>
            <dl className="grid grid-cols-2 gap-2 mt-3 text-xs">
              <dt style={{ color: 'var(--color-text-secondary)' }}>{t('adminErrors.detail.requestId')}</dt>
              <dd className="font-mono break-all">{e.requestId ?? '-'}</dd>
              <dt style={{ color: 'var(--color-text-secondary)' }}>{t('adminErrors.detail.route')}</dt>
              <dd className="font-mono break-all">{e.route ?? '-'}</dd>
              <dt style={{ color: 'var(--color-text-secondary)' }}>{t('adminErrors.detail.release')}</dt>
              <dd className="font-mono">{e.release}</dd>
              <dt style={{ color: 'var(--color-text-secondary)' }}>{t('adminErrors.detail.status')}</dt>
              <dd>{e.statusCode ?? '-'}</dd>
            </dl>
            <p className="text-sm mt-3 break-all">{e.message}</p>
            <h4 className="text-xs font-semibold mt-3">{t('adminErrors.detail.stack')}</h4>
            {e.stack ? <pre className="text-xs overflow-x-auto mt-1 p-2 whitespace-pre" style={{ backgroundColor: 'var(--color-surface-muted)' }}>{e.stack}</pre> : <p className="text-xs">{t('adminErrors.detail.noStack')}</p>}
            <h4 className="text-xs font-semibold mt-3">{t('adminErrors.detail.breadcrumbs')}</h4>
            {e.breadcrumbs.length === 0 ? (
              <p className="text-xs">{t('adminErrors.detail.noBreadcrumbs')}</p>
            ) : (
              <ol className="text-xs font-mono mt-1 space-y-0.5">
                {e.breadcrumbs.map((b, i) => (
                  <li key={i}>
                    {b.at.slice(11, 19)} {b.type} {b.message}
                    {b.data ? ` ${Object.entries(b.data).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}
                  </li>
                ))}
              </ol>
            )}
          </details>
        ))}
      </section>
    </div>
  );
}
