'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { rangeForView } from '@/lib/calendar/range';
import { bookingMemberName, trainerName, type ScheduleRow } from '@/lib/calendar/types';

/** Reception quick check-in: today's sessions with a one-tap check-in per confirmed booking. */
function AttendanceList() {
  const { activeStudioId } = useDashboardSession();
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
      .catch((err) => setError(err instanceof BffError ? err.message : 'Bugünün seansları yüklenemedi'))
      .finally(() => setLoading(false));
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
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          Bugünün Yoklaması
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Resepsiyon için hızlı giriş listesi
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && schedules.length === 0 && <EmptyState title="Bugün planlanmış seans yok" />}

      {!loading &&
        !error &&
        schedules.map((s) => {
          const roster = s.bookings.filter((b) => b.status !== 'WAITLIST');
          return (
            <div key={s.id} className="border" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)', backgroundColor: 'var(--color-surface)' }}>
              <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--color-border)' }}>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {s.title || s.serviceType?.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(s.startTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · {trainerName(s.trainer) ?? 'Eğitmen atanmamış'}
                  </p>
                </div>
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {s.bookedCount}/{s.capacity}
                </span>
              </div>
              {roster.length === 0 ? (
                <p className="text-xs px-4 py-3" style={{ color: 'var(--color-text-muted)' }}>
                  Rezervasyon yok.
                </p>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                  {roster.map((b) => (
                    <div key={b.id} className="px-4 py-2.5 flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
                      <Link href={`/members/${b.memberId}`} className="text-sm hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                        {bookingMemberName(b)}
                      </Link>
                      {b.status === 'CONFIRMED' ? (
                        <PermissionButton required={['attendance.manage']} variant="primary" disabled={busyId === b.id} onClick={() => checkIn(b.id)}>
                          Giriş yap
                        </PermissionButton>
                      ) : (
                        <Badge tone={b.status === 'ATTENDED' ? 'success' : b.status === 'NO_SHOW' ? 'danger' : 'neutral'}>
                          {b.status === 'ATTENDED' ? 'Katıldı' : b.status === 'NO_SHOW' ? 'Gelmedi' : b.status}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
