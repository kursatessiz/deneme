'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EVENT_STATUSES } from '@platform/shared';
import type { EventDTO, EventStatus } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { hasAnyPermission } from '@/lib/nav';
import { useBff } from '@/lib/session/use-bff';
import { PageHeader, inputClass, inputStyle, useDateFormat } from '@/components/growth/ui';

function EventList() {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
  const fmt = useDateFormat();
  const [status, setStatus] = useState<EventStatus | ''>('');
  const path = activeStudioId ? `studios/${activeStudioId}/events${status ? `?status=${status}` : ''}` : null;
  const { data, loading, error, forbidden } = useBff<{ items: EventDTO[] }>(path, activeStudioId);
  const canManage = hasAnyPermission(['events.manage'], permissions, isOwner);

  if (forbidden) return <ErrorState message={t('events.forbidden')} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('events.title')}
        subtitle={t('events.subtitle')}
        actions={
          canManage ? (
            <Link
              href="/etkinlikler/yeni"
              className="text-xs font-medium px-3 py-1.5"
              style={{ background: 'var(--gradient-brand)', color: 'var(--color-on-primary)', borderRadius: 'var(--radius-button)' }}
            >
              {t('events.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="max-w-xs space-y-1">
        <label htmlFor="events-status" className="block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('events.filter.status')}
        </label>
        <select id="events-status" className={inputClass} style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as EventStatus | '')}>
          <option value="">{t('events.filter.all')}</option>
          {EVENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`events.status.${s}`)}
            </option>
          ))}
        </select>
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState title={t('events.empty')} description={t('events.emptyHint')} action={{ labelKey: 'events.new', href: '/etkinlikler/yeni', permissions: ['events.manage'] }} />
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <div className="overflow-x-auto" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <table className="w-full text-sm" aria-label={t('events.title')}>
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <th className="px-4 py-2 font-medium">{t('events.col.title')}</th>
                <th className="px-4 py-2 font-medium">{t('events.col.date')}</th>
                <th className="px-4 py-2 font-medium">{t('events.col.status')}</th>
                <th className="px-4 py-2 font-medium">{t('events.col.seats')}</th>
                <th className="px-4 py-2 font-medium">{t('events.col.waitlist')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-2.5">
                    <Link href={`/etkinlikler/${encodeURIComponent(e.id)}`} className="font-medium hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                      {e.title}
                    </Link>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {t(`events.kind.${e.kind}`)}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {e.startsAt ? fmt.dateTime(e.startsAt) : t('events.noDate')}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge>{t(`events.status.${e.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('events.seats', { taken: fmt.number(e.seatsTaken), capacity: fmt.number(e.capacity) })}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {e.waitlistEnabled ? fmt.number(e.waitlistCount) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['events.view']}>
      <EventList />
    </PageGuard>
  );
}
