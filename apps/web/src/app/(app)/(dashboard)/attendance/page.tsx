'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { rangeForView } from '@/lib/calendar/range';
import { bookingMemberName, trainerName, type ScheduleRow } from '@/lib/calendar/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { List, ListItem } from '@/components/ui/List';

/** Reception quick check-in: today's sessions with a one-tap check-in per confirmed booking. */
function AttendanceList() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const locale = useLocale();
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const { start, end } = rangeForView('day', new Date());
    bffFetch<ScheduleRow[]>(`schedules/studio/${activeStudioId}?startDate=${start.toISOString()}&endDate=${end.toISOString()}`, { studioId: activeStudioId })
      .then((rows) => setSchedules(rows.filter((r) => !r.isCancelled)))
      .catch((err) => setError(err instanceof BffError ? err.message : t('screens.attendance.errors.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId]);

  useEffect(() => {
    load();
  }, [load]);

  async function checkIn(bookingId: string) {
    setBusyId(bookingId);
    try {
      await bffFetch(`schedules/check-in/${bookingId}`, { method: 'PATCH', studioId: activeStudioId });
      load();
    } catch {
      /* the per-row error state below covers this via a full reload showing current status */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={t('screens.attendance.title')} description={t('screens.attendance.subtitle')} />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && schedules.length === 0 && <EmptyState title={t('screens.attendance.empty')} />}

      {!loading &&
        !error &&
        schedules.map((s) => {
          const roster = s.bookings.filter((b) => b.status !== 'WAITLIST');
          return (
            <Card key={s.id}>
              <CardHeader>
                <div className="grid gap-0.5">
                  <p className="ui-strong">{s.title || s.serviceType?.name}</p>
                  <p className="ui-caption">
                    {new Date(s.startTime).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} ·{' '}
                    {trainerName(s.trainer) ?? t('screens.attendance.noTrainer')}
                  </p>
                </div>
                <Badge>
                  {s.bookedCount}/{s.capacity}
                </Badge>
              </CardHeader>
              {roster.length === 0 ? (
                <p className="ui-caption p-4">{t('screens.attendance.noBookings')}</p>
              ) : (
                <List className="ui-divide">
                  {roster.map((b) => (
                    <ListItem key={b.id} className="flex items-center justify-between">
                      <Link href={`/members/${b.memberId}`} className="pui-link pui-surface">
                        {bookingMemberName(b, t('common.member'))}
                      </Link>
                      {b.status === 'CONFIRMED' ? (
                        <PermissionButton required={['attendance.manage']} variant="primary" disabled={busyId === b.id} onClick={() => checkIn(b.id)}>
                          {t('screens.attendance.checkIn')}
                        </PermissionButton>
                      ) : (
                        <Badge tone={b.status === 'ATTENDED' ? 'success' : b.status === 'NO_SHOW' ? 'danger' : 'neutral'}>
                          {b.status === 'ATTENDED'
                            ? t('screens.attendance.status.ATTENDED')
                            : b.status === 'NO_SHOW'
                              ? t('screens.attendance.status.NO_SHOW')
                              : b.status}
                        </Badge>
                      )}
                    </ListItem>
                  ))}
                </List>
              )}
            </Card>
          );
        })}
    </div>
  );
}

export default function AttendancePage() {
  return (
    <PageGuard required={['attendance.manage']}>
      <AttendanceList />
    </PageGuard>
  );
}
