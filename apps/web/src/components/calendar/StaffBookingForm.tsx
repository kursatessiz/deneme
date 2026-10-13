'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookSessionSchema, firstIssueMessage } from '@platform/shared';
import type { BookingNoticeDTO, ScheduleSpotsDTO } from '@platform/shared';
import { Search } from 'lucide-react';
import { bffFetch, BffError } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Confirm';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Addon, InputGroup } from '@/components/ui/InputGroup';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/ToastHost';
import {
  buildBookBody,
  isSessionFull,
  NO_CHARGE_PACKAGE,
  repeatIntervalConflict,
  usablePackages,
  type PackageDefinitionCoverage,
} from '@/lib/calendar/staff-booking';
import type { MemberDetail } from '@/lib/members/types';

interface MemberSearchRow {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface StaffBookingMember {
  id: string;
  name: string;
}

/**
 * Staff books a member into one session (POST /schedules/book, bookings.manage). Shared by the calendar
 * session panel (member is searched) and the member card (member is fixed). Mirrors the mobile walk-in flow:
 * the minimum-repeat-interval rule is confirmed in a danger dialog and retried with the staff override,
 * API notices are shown as toasts, and a full session offers the waitlist.
 */
export function StaffBookingForm({
  studioId,
  scheduleId,
  serviceTypeId,
  fixedMember,
  onBooked,
  onClose,
}: {
  studioId: string;
  scheduleId: string;
  serviceTypeId: string;
  fixedMember?: StaffBookingMember;
  onBooked: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [member, setMember] = useState<StaffBookingMember | null>(fixedMember ?? null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemberSearchRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [packageId, setPackageId] = useState('');
  const [spotChoice, setSpotChoice] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const packageTouched = useRef(false);

  const { data: spots } = useBff<ScheduleSpotsDTO>(`schedules/${scheduleId}/spots`, studioId);
  const { data: definitions } = useBff<PackageDefinitionCoverage[]>(`catalog/package-definitions/studio/${studioId}`, studioId);

  // Member search (the same endpoint the members page uses).
  useEffect(() => {
    if (member) return;
    const text = query.trim();
    if (text.length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      bffFetch<MemberSearchRow[]>(`members/studio/${studioId}?search=${encodeURIComponent(text)}`, { studioId })
        .then((rows) => {
          setResults(rows);
          setError(null);
        })
        .catch((err) => setError(err instanceof BffError ? err.message : t('staffBooking.errors.membersLoadFailed')))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, member, studioId]);

  // The chosen member's packages, to offer the ones that can pay for this session.
  useEffect(() => {
    setDetail(null);
    if (!member) return;
    let cancelled = false;
    bffFetch<MemberDetail>(`members/${member.id}/studio/${studioId}`, { studioId })
      .then((row) => {
        if (!cancelled) setDetail(row);
      })
      .catch(() => {
        /* without members.view detail the package stays unset and the API decides */
      });
    return () => {
      cancelled = true;
    };
  }, [member, studioId]);

  const packages = useMemo(
    () => (detail ? usablePackages(detail.packages, definitions ?? null, serviceTypeId) : []),
    [detail, definitions, serviceTypeId],
  );

  useEffect(() => {
    if (packageTouched.current) return;
    // '' lets the API pick the soonest-expiring usable package.
    setPackageId('');
  }, [packages]);

  function packageLabel(pkg: (typeof packages)[number]): string {
    const name = pkg.packageDefinition?.name ?? t('members.card.defaultPackageName');
    return pkg.entitlementKind === 'TIME_UNLIMITED'
      ? t('staffBooking.packageOption.unlimited', { name })
      : t('staffBooking.packageOption.units', { name, remaining: pkg.remainingUnits ?? 0 });
  }

  async function book(overrideRepeatInterval: boolean): Promise<void> {
    if (!member) return;
    const parsed = BookSessionSchema.safeParse(
      buildBookBody({
        studioId,
        scheduleId,
        memberId: member.id,
        memberPackageId: packageId,
        resourceIds: Object.values(spotChoice),
        overrideRepeatInterval,
      }),
    );
    if (!parsed.success) {
      setError(firstIssueMessage(parsed.error, t) ?? t('staffBooking.errors.bookingFailed'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await bffFetch<{ notices?: BookingNoticeDTO[] }>('schedules/book', { method: 'POST', studioId, body: parsed.data });
      toast.show(t('staffBooking.booked'), 'success');
      // Non-blocking information from the API (e.g. a no-show inside the repeat window).
      for (const notice of created.notices ?? []) toast.show(t('staffBooking.noticeTitle', { message: notice.message }), 'theme');
      onBooked();
    } catch (err) {
      const conflict = overrideRepeatInterval ? null : repeatIntervalConflict(err instanceof BffError ? err : null);
      if (conflict) {
        const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(conflict.date));
        setSubmitting(false);
        const accepted = await confirm({
          title: t('staffBooking.repeatOverride.title'),
          message: t('staffBooking.repeatOverride.body', { count: conflict.count, date }),
          confirmLabel: t('staffBooking.repeatOverride.confirm'),
          danger: true,
        });
        if (accepted) await book(true);
        return;
      }
      if (err instanceof BffError && isSessionFull(err)) setFull(true);
      setError(err instanceof BffError ? err.message : t('staffBooking.errors.bookingFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function joinWaitlist(): Promise<void> {
    if (!member) return;
    setSubmitting(true);
    setError(null);
    try {
      await bffFetch('schedules/waitlist', {
        method: 'POST',
        studioId,
        body: { studioId, scheduleId, memberId: member.id, ...(packageId && packageId !== NO_CHARGE_PACKAGE ? { memberPackageId: packageId } : {}) },
      });
      toast.show(t('staffBooking.waitlistJoined'), 'success');
      onBooked();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('staffBooking.errors.waitlistFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void book(false);
      }}
    >
      {member ? (
        <div className="flex items-center justify-between gap-2">
          <span className="ui-strong">{t('staffBooking.chosenMember', { name: member.name })}</span>
          {!fixedMember && (
            <Button
              variant="link"
              tone="muted"
              size="sm"
              onClick={() => {
                setMember(null);
                setResults(null);
                setFull(false);
                setError(null);
              }}
            >
              {t('staffBooking.changeMember')}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          <FieldGroup label={t('staffBooking.searchLabel')} hint={t('staffBooking.searchHint')}>
            <InputGroup>
              <Addon>
                <Search className="ui-icon" aria-hidden="true" />
              </Addon>
              <Input autoFocus placeholder={t('staffBooking.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </InputGroup>
          </FieldGroup>
          {results && results.length === 0 && !searching && <p className="ui-caption">{t('staffBooking.noResults')}</p>}
          {results && results.length > 0 && (
            <ul className="pui-list pui-striped" aria-label={t('staffBooking.member')}>
              {results.slice(0, 8).map((row) => (
                <li key={row.id} className="pui-list-item">
                  <Button
                    variant="link"
                    tone="surface"
                    block
                    onClick={() => setMember({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim() })}
                  >
                    {row.firstName} {row.lastName}
                    {row.phone ? ` · ${row.phone}` : ''}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {member && (
        <>
          <FieldGroup label={t('staffBooking.package')} hint={packages.length === 0 && detail ? t('staffBooking.packageNoneHint') : undefined}>
            <Select
              value={packageId}
              onChange={(e) => {
                packageTouched.current = true;
                setPackageId(e.target.value);
              }}
            >
              <option value="">{t('staffBooking.packageAuto')}</option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {packageLabel(pkg)}
                </option>
              ))}
              <option value={NO_CHARGE_PACKAGE}>{t('staffBooking.packageNone')}</option>
            </Select>
          </FieldGroup>

          {spots?.groups.map((group) => (
            <FieldGroup key={group.resourceTypeId} label={t('staffBooking.spot', { group: group.resourceTypeName })}>
              <Select
                value={spotChoice[group.resourceTypeId] ?? ''}
                onChange={(e) => setSpotChoice((prev) => ({ ...prev, [group.resourceTypeId]: e.target.value }))}
              >
                <option value="">{t('staffBooking.spotNone')}</option>
                {group.spots.map((spot) => {
                  const label = spot.label ? `${spot.name} (${spot.label})` : spot.name;
                  const unavailable = spot.status === 'TAKEN' || spot.status === 'MAINTENANCE';
                  return (
                    <option key={spot.id} value={spot.id} disabled={unavailable}>
                      {spot.status === 'TAKEN'
                        ? t('staffBooking.spotTaken', { name: label })
                        : spot.status === 'MAINTENANCE'
                          ? t('staffBooking.spotMaintenance', { name: label })
                          : label}
                    </option>
                  );
                })}
              </Select>
            </FieldGroup>
          ))}
        </>
      )}

      {full && <p className="ui-caption">{t('staffBooking.waitlistFull')}</p>}
      {error && (
        <p className="ui-caption ui-text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="outline" tone="surface" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        {full && member && (
          <Button variant="outline" tone="theme" disabled={submitting} onClick={() => void joinWaitlist()}>
            {t('staffBooking.joinWaitlist')}
          </Button>
        )}
        <Button type="submit" disabled={submitting || !member}>
          {submitting ? t('staffBooking.submitting') : t('staffBooking.submit')}
        </Button>
      </div>
    </form>
  );
}
