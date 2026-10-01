'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { bffFetch, BffError } from '@/lib/session/client';
import { Badge } from '@/components/common/Badge';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { hasAnyPermission } from '@/lib/nav';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bookingMemberName, trainerName, type ScheduleRow, type TrainerRow, type WaitlistRow } from '@/lib/calendar/types';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  CONFIRMED: 'neutral',
  ATTENDED: 'success',
  CANCELLED_EARLY: 'neutral',
  CANCELLED_LATE: 'warning',
  NO_SHOW: 'danger',
  WAITLIST: 'warning',
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
  const locale = useLocale();
  const t = useT();
  const statusLabel = (s: string) => t(`calendar.detail.status.${s}`);

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
      setError(err instanceof BffError ? err.message : t('calendar.detail.errors.actionFailed'));
    } finally {
      setBusyId(null);
    }
  }

  const roster = schedule.bookings.filter((b) => b.status !== 'WAITLIST');
  const start = new Date(schedule.startTime);
  const end = new Date(schedule.endTime);

  return (
    <aside className="pui-card w-full lg:w-[380px] shrink-0 overflow-y-auto">
      <div className="pui-card-header flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 className="ui-heading" style={{ color: 'var(--pui-text)' }}>
            {schedule.title || schedule.serviceType?.name || t('calendar.detail.defaultTitle')}
          </h3>
          <p className="ui-caption">
            {start.toLocaleString(locale, { weekday: 'long', day: '2-digit', month: 'long' })} ·{' '}
            {start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}-
            {end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
          </p>
          {trainerName(schedule.trainer) && (
            <p className="ui-caption">
              {t('calendar.detail.trainer', { name: trainerName(schedule.trainer) ?? '' })}
              {schedule.originalTrainerId && t('calendar.detail.trainerSubstituted')}
            </p>
          )}
          {schedule.resource?.name && <p className="ui-caption">{t('calendar.detail.resource', { name: schedule.resource.name })}</p>}
        </div>
        <Button variant="link" tone="muted" size="sm" iconOnly onClick={onClose} aria-label={t('calendar.detail.close')} icon={<X className="ui-icon" aria-hidden="true" />} />
      </div>

      <div className="pui-card-content gap-4">
        {schedule.isCancelled && (
          <div>
            <Badge tone="danger">
              {t('calendar.detail.cancelled')}
              {schedule.cancellationReason ? `: ${schedule.cancellationReason}` : ''}
            </Badge>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="ui-caption">{t('calendar.detail.capacity')}</span>
          <span className="ui-heading" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {schedule.bookedCount}/{schedule.capacity}
          </span>
        </div>

        {!schedule.isCancelled && (
          <div className="flex flex-wrap gap-2">
            <PermissionButton required={['schedule.manage']} variant="secondary" onClick={onEdit}>
              {t('calendar.detail.edit')}
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
              {t('calendar.detail.cancelSession')}
            </PermissionButton>
          </div>
        )}

        {!schedule.isCancelled && canManageSchedule && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-caption">{t('calendar.detail.substituteTrainer')}</span>
            <Select className="ui-btn-sm" value={substituteId} onChange={(e) => setSubstituteId(e.target.value)}>
              <option value="">{t('calendar.detail.chooseTrainer')}</option>
              {trainers.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.firstName} {tr.lastName}
                </option>
              ))}
            </Select>
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
              {t('calendar.detail.substitute')}
            </PermissionButton>
          </div>
        )}

        <div className="grid gap-2">
          <h4 className="ui-caption" style={{ fontWeight: 600 }}>
            {t('calendar.detail.attendees', { count: roster.length })}
          </h4>
          {roster.length === 0 ? (
            <p className="ui-caption">{t('calendar.detail.noBookings')}</p>
          ) : (
            <ul className="pui-list pui-striped">
              {roster.map((b) => (
                <li key={b.id} className="pui-list-item flex items-center justify-between gap-2">
                  <div className="grid gap-1 min-w-0">
                    <Link href={`/members/${b.memberId}`} className="pui-link pui-surface truncate">
                      {bookingMemberName(b, t('common.member'))}
                    </Link>
                    <div>
                      <Badge tone={STATUS_TONE[b.status] ?? 'neutral'}>{statusLabel(b.status)}</Badge>
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
                        {t('calendar.detail.checkIn')}
                      </PermissionButton>
                      <PermissionButton
                        required={['attendance.manage']}
                        variant="ghost"
                        disabled={busyId === b.id}
                        onClick={() => run(b.id, () => bffFetch(`schedules/no-show/${b.id}`, { method: 'PATCH', studioId, body: {} }))}
                      >
                        {t('calendar.detail.noShow')}
                      </PermissionButton>
                      <PermissionButton
                        required={['bookings.manage']}
                        variant="danger"
                        disabled={busyId === b.id}
                        onClick={() => run(b.id, () => bffFetch('schedules/cancel', { method: 'POST', studioId, body: { bookingId: b.id, cancelledBy: 'STUDIO' } }))}
                      >
                        {t('calendar.detail.cancel')}
                      </PermissionButton>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {waitlist.length > 0 && (
          <div className="grid gap-2">
            <h4 className="ui-caption" style={{ fontWeight: 600 }}>
              {t('calendar.detail.waitlist', { count: waitlist.length })}
            </h4>
            <ol className="pui-list pui-striped">
              {waitlist.map((w) => (
                <li key={w.id} className="pui-list-item">
                  {w.placeInLine}. {w.member?.membership?.user ? `${w.member.membership.user.firstName} ${w.member.membership.user.lastName}` : t('calendar.detail.member')}
                </li>
              ))}
            </ol>
          </div>
        )}

        {error && (
          <p className="ui-caption" style={{ color: 'var(--pui-error)' }}>
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
