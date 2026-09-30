'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ERROR_ALERT_KINDS } from '@platform/shared';
import type { ErrorAlertListDTO } from '@platform/shared';
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

/** Super admin: stored error alerts (spike, new group, regression) with acknowledgement and sink delivery state (H3). */
export default function AdminErrorAlertsPage() {
  const t = useT();
  const locale = useLocale();
  const [kind, setKind] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page) });
  if (kind) params.set('kind', kind);
  if (state) params.set('acknowledged', state === 'acknowledged' ? 'true' : 'false');
  const { data, loading, error, forbidden } = useBff<ErrorAlertListDTO>(`admin/errors/alerts?${params.toString()}`, null, refreshKey);

  if (forbidden) return <EmptyState title={t('adminErrors.accessDenied')} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const acknowledge = async (id: string) => {
    setMessage(null);
    try {
      await bffFetch(`admin/errors/alerts/${id}/acknowledge`, { method: 'POST', body: {} });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage(err instanceof BffError ? err.message : t('adminErrors.actionFailed'));
    }
  };

  return (
    <div className="space-y-6">
      <Link href="/admin/hatalar" className="text-sm hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
        {t('adminErrors.detail.back')}
      </Link>
      <div>
        <h2 className="text-xl font-bold">{t('adminErrors.alerts.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminErrors.alerts.subtitle')}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          aria-label={t('adminErrors.alerts.filter.kind')}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
          className="border px-3 py-2 text-sm"
          style={inputStyle}
        >
          <option value="">{t('adminErrors.alerts.filter.all')}</option>
          {ERROR_ALERT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`adminErrors.alert.kind.${k}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('adminErrors.alerts.filter.state')}
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
          className="border px-3 py-2 text-sm"
          style={inputStyle}
        >
          <option value="">{t('adminErrors.alerts.filter.all')}</option>
          <option value="open">{t('adminErrors.alerts.filter.open')}</option>
          <option value="acknowledged">{t('adminErrors.alerts.filter.acknowledged')}</option>
        </select>
      </div>

      {message && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
          {message}
        </p>
      )}
      {loading && !data && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && data.items.length === 0 && <EmptyState title={t('adminErrors.alerts.empty')} />}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto border" style={card}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {(['kind', 'group', 'count', 'at', 'delivery'] as const).map((col) => (
                  <th key={col} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    {t(`adminErrors.alerts.col.${col}`)}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id} className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-3 py-2">{t(`adminErrors.alert.kind.${a.kind}`)}</td>
                  <td className="px-3 py-2 break-all">
                    <Link href={`/admin/hatalar/${a.groupId}`} className="hover:underline">
                      {a.groupTitle}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{a.kind === 'SPIKE' ? t('adminErrors.alerts.count', { windowCount: a.windowCount, threshold: a.threshold }) : '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{dateTime.format(new Date(a.createdAt))}</td>
                  <td className="px-3 py-2 text-xs">
                    {a.deliveries.length === 0
                      ? '-'
                      : a.deliveries.map((d) => (
                          <div key={d.sink}>{t('adminErrors.alerts.delivery', { sink: t(`adminErrors.alerts.sink.${d.sink}`), status: t(`adminErrors.alerts.deliveryStatus.${d.status}`) })}</div>
                        ))}
                  </td>
                  <td className="px-3 py-2">
                    {a.acknowledgedAt ? (
                      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        {t('adminErrors.alerts.acknowledged')}
                      </span>
                    ) : (
                      <button type="button" onClick={() => acknowledge(a.id)} className="px-3 py-1 text-xs font-medium border" style={{ borderRadius: 'var(--radius-button)', borderColor: 'var(--color-border)' }}>
                        {t('adminErrors.alerts.acknowledge')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && pages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border" style={{ borderRadius: 'var(--radius-button)', borderColor: 'var(--color-border)' }}>
            {t('adminErrors.page.previous')}
          </button>
          <span>{t('adminErrors.page.info', { page, pages, total: data.total })}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1 border" style={{ borderRadius: 'var(--radius-button)', borderColor: 'var(--color-border)' }}>
            {t('adminErrors.page.next')}
          </button>
        </div>
      )}
    </div>
  );
}
