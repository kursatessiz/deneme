'use client';

import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { hasAnyPermission } from '@/lib/nav';
import type { ScheduleRow } from '@/lib/calendar/types';
import { Badge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/LinkButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

function todayRange(): { start: string; end: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function trainerName(row: ScheduleRow): string | null {
  const user = row.trainer?.membership?.user;
  return user ? `${user.firstName} ${user.lastName}` : null;
}

function TodayList() {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const range = useMemo(todayRange, []);
  const query = new URLSearchParams({ startDate: range.start, endDate: range.end }).toString();
  const { data, loading, error } = useBff<ScheduleRow[]>(`schedules/studio/${activeStudioId}?${query}`, activeStudioId);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const rows = (data ?? []).slice().sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <section className="pui-card" aria-labelledby="today-schedule-title">
      <div className="pui-card-header flex items-center justify-between gap-3">
        <h3 id="today-schedule-title" className="ui-heading">
          {t('screens.dashboard.today.title')}
        </h3>
        <LinkButton href="/calendar" variant="link" tone="theme" size="sm">
          {t('screens.dashboard.today.openCalendar')}
        </LinkButton>
      </div>
      {loading && (
        <div className="pui-card-content">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height="2.5rem" />
          ))}
        </div>
      )}
      {!loading && error && <p className="pui-card-content ui-text-error">{t('screens.dashboard.today.loadFailed')}</p>}
      {!loading && !error && rows.length === 0 && (
        <div className="p-4">
          <EmptyState icon={<CalendarDays className="w-8 h-8" aria-hidden="true" />} title={t('screens.dashboard.today.empty')} />
        </div>
      )}
      {!loading && !error && rows.length > 0 && (
        <ul className="pui-list">
          {rows.map((row) => {
            const trainer = trainerName(row);
            const full = row.bookedCount >= row.capacity;
            return (
              <li key={row.id} className="pui-list-item flex items-center gap-4">
                <span className="ui-heading" style={{ fontVariantNumeric: 'tabular-nums', minWidth: '3.25rem' }}>
                  {time.format(new Date(row.startTime))}
                </span>
                <span className="grid flex-1 min-w-0">
                  <span className="truncate">{row.title}</span>
                  <span className="ui-caption truncate">{[row.serviceType?.name, trainer, row.resource?.name].filter(Boolean).join(' · ')}</span>
                </span>
                {row.isCancelled ? (
                  <Badge tone="error">{t('screens.dashboard.today.cancelled')}</Badge>
                ) : (
                  <Badge tone={full ? 'warn' : 'muted'}>
                    {full ? t('screens.dashboard.today.full') : `${row.bookedCount}/${row.capacity}`}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Today's sessions for memberships that can see the schedule. */
export function TodaySchedule() {
  const { permissions, isOwner } = useDashboardSession();
  if (!hasAnyPermission(['schedule.view'], permissions, isOwner)) return null;
  return <TodayList />;
}
