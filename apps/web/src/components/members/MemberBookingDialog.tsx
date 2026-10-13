'use client';

import { useEffect, useMemo, useState } from 'react';
import { bffFetch, BffError } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { StaffBookingForm } from '@/components/calendar/StaffBookingForm';
import {
  bookableSessions,
  coveredServiceTypeIds,
  type PackageDefinitionCoverage,
} from '@/lib/calendar/staff-booking';
import type { ScheduleRow } from '@/lib/calendar/types';
import type { MemberPackageRow } from '@/lib/members/types';

const HORIZON_DAYS = 14;

/**
 * Member card booking: pick an upcoming session with a free place (limited to the services the member's
 * packages cover), then book it with the same form the calendar panel uses.
 */
export function MemberBookingDialog({
  studioId,
  memberId,
  memberName,
  packages,
  onBooked,
  onClose,
}: {
  studioId: string;
  memberId: string;
  memberName: string;
  packages: MemberPackageRow[];
  onBooked: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [sessions, setSessions] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyCovered, setOnlyCovered] = useState(true);
  const [picked, setPicked] = useState<ScheduleRow | null>(null);
  const { data: definitions } = useBff<PackageDefinitionCoverage[]>(`catalog/package-definitions/studio/${studioId}`, studioId);

  useEffect(() => {
    const start = new Date();
    const end = new Date(start.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({ startDate: start.toISOString(), endDate: end.toISOString() });
    bffFetch<ScheduleRow[]>(`schedules/studio/${studioId}?${params.toString()}`, { studioId })
      .then(setSessions)
      .catch((err) => setError(err instanceof BffError ? err.message : t('staffBooking.errors.sessionsLoadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);

  const covered = useMemo(() => coveredServiceTypeIds(packages, definitions ?? null), [packages, definitions]);

  const hasCoverage = !!covered && covered.size > 0;
  const visible = useMemo(
    () => bookableSessions(sessions ?? [], onlyCovered && hasCoverage ? covered : null),
    [sessions, onlyCovered, hasCoverage, covered],
  );

  if (picked) {
    return (
      <div className="grid gap-3">
        <p className="ui-caption">
          {t('staffBooking.sessionLine', {
            title: picked.title || picked.serviceType?.name || '',
            when: new Date(picked.startTime).toLocaleString(locale, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
          })}
        </p>
        <StaffBookingForm
          studioId={studioId}
          scheduleId={picked.id}
          serviceTypeId={picked.serviceTypeId}
          fixedMember={{ id: memberId, name: memberName }}
          onBooked={onBooked}
          onClose={onClose}
        />
        <div>
          <Button variant="link" tone="muted" size="sm" onClick={() => setPicked(null)}>
            {t('staffBooking.sessions.back')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="ui-caption">{t('staffBooking.sessions.title')}</p>
      {hasCoverage && <Checkbox label={t('staffBooking.sessions.onlyCovered')} checked={onlyCovered} onChange={(e) => setOnlyCovered(e.target.checked)} />}
      {error && (
        <p className="ui-caption ui-text-error" role="alert">
          {error}
        </p>
      )}
      {sessions && visible.length === 0 && !error && <p className="ui-caption">{t('staffBooking.sessions.empty')}</p>}
      {visible.length > 0 && (
        <ul className="pui-list pui-striped max-h-[50vh] overflow-y-auto">
          {visible.map((s) => (
            <li key={s.id} className="pui-list-item flex items-center justify-between gap-3">
              <div className="grid gap-0.5 min-w-0">
                <span className="ui-strong truncate">{s.title || s.serviceType?.name}</span>
                <span className="ui-caption">
                  {new Date(s.startTime).toLocaleString(locale, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {' · '}
                  {t('staffBooking.sessions.free', { count: s.capacity - s.bookedCount })}
                </span>
              </div>
              <Button size="sm" variant="outline" tone="surface" aria-label={`${t('staffBooking.sessions.pick')}: ${s.title || s.serviceType?.name}`} onClick={() => setPicked(s)}>
                {t('staffBooking.sessions.pick')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end pt-2">
        <Button variant="outline" tone="surface" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
