'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { bffFetch, BffError } from '@/lib/session/client';
import { Badge } from '@/components/common/Badge';
import { PermissionButton } from '@/components/common/PermissionButton';
import { hasAnyPermission } from '@/lib/nav';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { bookingMemberName, trainerName, type ScheduleRow, type TrainerRow, type WaitlistRow } from '@/lib/calendar/types';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  CONFIRMED: 'neutral',
  ATTENDED: 'success',
  CANCELLED_EARLY: 'neutral',
  CANCELLED_LATE: 'warning',
  NO_SHOW: 'danger',
  WAITLIST: 'warning',
};

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Onaylı',
  ATTENDED: 'Katıldı',
  CANCELLED_EARLY: 'İptal',
  CANCELLED_LATE: 'Geç iptal',
  NO_SHOW: 'Gelmedi',
  WAITLIST: 'Bekleme listesi',
};

export function SessionDetailPanel({
  studioId,
  schedule,
  trainers,
  onClose,
  onChanged,
  onEdit,
}: {
  studioId: string;
  schedule: ScheduleRow;
  trainers: TrainerRow[];
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [waitlist, setWaitlist] = useState<WaitlistRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [substituteId, setSubstituteId] = useState('');
  const { permissions, isOwner } = useDashboardSession();
  const canManageSchedule = hasAnyPermission(['schedule.manage'], permissions, isOwner);

  useEffect(() => {
    let cancelled = false;
    bffFetch<WaitlistRow[]>(`schedules/waitlist/${schedule.id}`, { studioId })
      .then((rows) => {
        if (!cancelled) setWaitlist(rows);
      })
      .catch(() => {
        /* staff without bookings.view simply see no waitlist section content */
      });
    return () => {
      cancelled = true;
    };
  }, [schedule.id, studioId]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'İşlem başarısız oldu');
    } finally {
      setBusyId(null);
    }
  }

  const roster = schedule.bookings.filter((b) => b.status !== 'WAITLIST');
  const start = new Date(schedule.startTime);
  const end = new Date(schedule.endTime);

  return (
    <aside
      className="w-full lg:w-[380px] shrink-0 border overflow-y-auto"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
    >
      <div className="p-4 flex items-start justify-between border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {schedule.title || schedule.serviceType?.name || 'Seans'}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {start.toLocaleString('tr-TR', { weekday: 'long', day: '2-digit', month: 'long' })} ·{' '}
            {start.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}-
            {end.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
          </p>
          {trainerName(schedule.trainer) && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              Eğitmen: {trainerName(schedule.trainer)}
              {schedule.originalTrainerId && ' (ikame)'}
            </p>
          )}
          {schedule.resource?.name && (
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Kaynak: {schedule.resource.name}
            </p>
          )}
        </div>
        <button onClick={onClose} className="p-1" style={{ color: 'var(--color-text-muted)' }} aria-label="Kapat">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {schedule.isCancelled && <Badge tone="danger">Seans iptal edildi{schedule.cancellationReason ? `: ${schedule.cancellationReason}` : ''}</Badge>}

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Kontenjan
          </span>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {schedule.bookedCount}/{schedule.capacity}
          </span>
        </div>

        {!schedule.isCancelled && (
          <div className="flex flex-wrap gap-2">
            <PermissionButton required={['schedule.manage']} variant="secondary" onClick={onEdit}>
              Seansı düzenle
            </PermissionButton>
            <PermissionButton
              required={['schedule.manage']}
              variant="danger"
              disabled={busyId === 'cancel-session'}
              onClick={() =>
                run('cancel-session', () =>
                  bffFetch(`schedules/${schedule.id}/cancel-session`, {
                    method: 'POST',
                    studioId,
                    body: { notifyMembers: true },
                  }),
                )
              }
            >
              Seansı iptal et
            </PermissionButton>
          </div>
        )}

        {!schedule.isCancelled && canManageSchedule && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              İkame eğitmen
            </span>
            <select
              className="text-xs px-2 py-1"
              style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
              value={substituteId}
              onChange={(e) => setSubstituteId(e.target.value)}
            >
              <option value="">Eğitmen seç</option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.firstName} {t.lastName}
                </option>
              ))}
            </select>
            <PermissionButton
              required={['schedule.manage']}
              variant="secondary"
              disabled={!substituteId || busyId === 'substitute'}
              onClick={() =>
                run('substitute', () =>
                  bffFetch(`schedules/${schedule.id}/substitute`, { method: 'POST', studioId, body: { trainerId: substituteId } }),
                )
              }
            >
              Değiştir
            </PermissionButton>
          </div>
        )}

        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Katılımcılar ({roster.length})
          </h4>
          <div className="space-y-1.5">
            {roster.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Henüz rezervasyon yok.
              </p>
            )}
            {roster.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between px-3 py-2"
                style={{ borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-surface-muted)' }}
              >
                <div className="min-w-0">
                  <Link href={`/members/${b.memberId}`} className="text-xs font-medium truncate hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                    {bookingMemberName(b)}
                  </Link>
                  <div className="mt-0.5">
                    <Badge tone={STATUS_TONE[b.status] ?? 'neutral'}>{STATUS_LABEL[b.status] ?? b.status}</Badge>
                  </div>
                </div>
                {b.status === 'CONFIRMED' && !schedule.isCancelled && (
                  <div className="flex gap-1 shrink-0">
                    <PermissionButton
                      required={['attendance.manage']}
                      variant="secondary"
                      disabled={busyId === b.id}
                      onClick={() => run(b.id, () => bffFetch(`schedules/check-in/${b.id}`, { method: 'PATCH', studioId }))}
                    >
                      Giriş yap
                    </PermissionButton>
                    <PermissionButton
                      required={['attendance.manage']}
                      variant="ghost"
                      disabled={busyId === b.id}
                      onClick={() => run(b.id, () => bffFetch(`schedules/no-show/${b.id}`, { method: 'PATCH', studioId, body: {} }))}
                    >
                      Gelmedi
                    </PermissionButton>
                    <PermissionButton
                      required={['bookings.manage']}
                      variant="danger"
                      disabled={busyId === b.id}
                      onClick={() => run(b.id, () => bffFetch('schedules/cancel', { method: 'POST', studioId, body: { bookingId: b.id, cancelledBy: 'STUDIO' } }))}
                    >
                      İptal
                    </PermissionButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {waitlist.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Bekleme listesi ({waitlist.length})
            </h4>
            <div className="space-y-1.5">
              {waitlist.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between px-3 py-2 text-xs"
                  style={{ borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-surface-muted)', color: 'var(--color-text-primary)' }}
                >
                  <span>
                    {w.placeInLine}. {w.member?.membership?.user ? `${w.member.membership.user.firstName} ${w.member.membership.user.lastName}` : 'Üye'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs" style={{ color: '#b42318' }}>
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
