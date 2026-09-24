'use client';

import { useMemo } from 'react';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';

interface ScheduleRow {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
  serviceType?: { name: string } | null;
  trainer?: { membership?: { user?: { firstName: string; lastName: string } } } | null;
}

function startOfWeek(): string {
  return new Date().toISOString();
}

function endOfWeek(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function CalendarWeek() {
  const { activeStudioId } = useDashboardSession();
  const range = useMemo(() => ({ start: startOfWeek(), end: endOfWeek() }), []);
  const path = `schedules/studio/${activeStudioId}?startDate=${encodeURIComponent(range.start)}&endDate=${encodeURIComponent(range.end)}`;
  const { data: schedules, loading, error } = useBff<ScheduleRow[]>(path, activeStudioId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          Ders Takvimi
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Önümüzdeki 7 gün
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!schedules || schedules.length === 0) && (
        <EmptyState title="Bu hafta planlanmış seans yok" description="Seans oluşturuldukça burada listelenecek." />
      )}
      {!loading && !error && schedules && schedules.length > 0 && (
        <div className="space-y-2">
          {schedules.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between p-4 border"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {s.title || s.serviceType?.name || 'Seans'}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {new Date(s.startTime).toLocaleString('tr-TR')}
                  {s.trainer?.membership?.user ? ` · ${s.trainer.membership.user.firstName} ${s.trainer.membership.user.lastName}` : ''}
                </p>
              </div>
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {s.bookedCount}/{s.capacity}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <PageGuard required={['schedule.view']}>
      <CalendarWeek />
    </PageGuard>
  );
}
