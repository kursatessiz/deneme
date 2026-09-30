'use client';

import { useEffect, useState } from 'react';
import type { StudioErrorGroupDTO, StudioErrorSettingsDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { BffError, bffFetch } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { SettingsHeader } from '@/components/settings/ui';

function ErrorList() {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<StudioErrorGroupDTO[]>(activeStudioId ? `studios/${activeStudioId}/errors` : null, activeStudioId);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data || data.length === 0) return <EmptyState title={t('errors.owner.empty')} />;

  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="overflow-x-auto border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
            {(['message', 'source', 'count', 'firstSeen', 'lastSeen', 'code', 'status'] as const).map((col) => (
              <th key={col} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t(`errors.owner.col.${col}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((g) => (
            <tr key={g.id} className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
              <td className="px-3 py-2 break-all">{g.safeMessage ?? t('errors.owner.serverError')}</td>
              <td className="px-3 py-2">{t(`errors.source.${g.source}`)}</td>
              <td className="px-3 py-2 tabular-nums">{new Intl.NumberFormat(locale).format(g.count)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{dateTime.format(new Date(g.firstSeenAt))}</td>
              <td className="px-3 py-2 whitespace-nowrap">{dateTime.format(new Date(g.lastSeenAt))}</td>
              <td className="px-3 py-2 font-mono">{g.lastCode ?? '-'}</td>
              <td className="px-3 py-2">{t(`errors.status.${g.status}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Opt-in e-mail to the owner about new error groups and spikes that affect this studio's users (H3). */
function NotifyToggle() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data } = useBff<StudioErrorSettingsDTO>(activeStudioId ? `studios/${activeStudioId}/errors/settings` : null, activeStudioId);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (data) setEnabled(data.ownerNotify);
  }, [data]);

  if (!activeStudioId || !data) return null;
  const change = async (next: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      await bffFetch(`studios/${activeStudioId}/errors/settings`, { method: 'PATCH', body: { ownerNotify: next }, studioId: activeStudioId });
      setEnabled(next);
      setMessage(t('errors.owner.notify.saved'));
    } catch (err) {
      setMessage(err instanceof BffError ? err.message : t('errors.owner.notify.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 p-5 border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <h3 className="text-sm font-semibold">{t('errors.owner.notify.title')}</h3>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {t('errors.owner.notify.description')}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => change(e.target.checked)} />
        {t('errors.owner.notify.toggle')}
      </label>
      {message && (
        <p role="status" className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {message}
        </p>
      )}
    </section>
  );
}

/** Tenant owner view of the studio's own errors (H1): safe message, code, counts; no stack traces. */
export default function StudioErrorsPage() {
  const t = useT();
  return (
    <PageGuard required={['errors.view']}>
      <div className="space-y-6">
        <SettingsHeader title={t('errors.owner.title')} description={t('errors.owner.description')} />
        <NotifyToggle />
        <ErrorList />
      </div>
    </PageGuard>
  );
}
