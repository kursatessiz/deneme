'use client';

import type { StudioErrorGroupDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
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

/** Tenant owner view of the studio's own errors (H1): safe message, code, counts; no stack traces. */
export default function StudioErrorsPage() {
  const t = useT();
  return (
    <PageGuard required={['errors.view']}>
      <div className="space-y-6">
        <SettingsHeader title={t('errors.owner.title')} description={t('errors.owner.description')} />
        <ErrorList />
      </div>
    </PageGuard>
  );
}
