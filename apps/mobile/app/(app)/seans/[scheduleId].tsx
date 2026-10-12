import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { isWithinJoinWindow, onColor } from '@platform/shared';
import type { BookingChargedPackageDTO, BookingNoticeDTO, JoinSessionResultDTO, MemberPackageDTO, ScheduleSelfStatusDTO, ScheduleSpotsDTO, SpotDTO, SpotGroupDTO, SpotStatus } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { useLocale, useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { borderWidth, palette, radii, spacing, TOUCH_TARGET, typography, useTheme, useThemeColors, useThemeFonts } from '../../../src/theme';
import type { Translate } from '@platform/shared';
import { Text } from '../../../src/components/Text';
import { openExternalUrl } from '../../../src/lib/externalLink';
import { confirmAction, showNotice } from '../../../src/lib/notice';
import { availableAction, cancelConfirmation } from '../../../src/lib/sessionSelfService';

const SPOT_SIZE = 48;
const SPOT_GAP = spacing[2];

function statusLabels(t: Translate): Record<SpotStatus, string> {
  return {
    AVAILABLE: t('mSessionBooking.spot.available'),
    TAKEN: t('mSessionBooking.spot.taken'),
    MAINTENANCE: t('mSessionBooking.spot.maintenance'),
    MINE: t('mSessionBooking.spot.mine'),
  };
}

function statusColor(status: SpotStatus, colors: ReturnType<typeof useThemeColors>): string {
  switch (status) {
    case 'AVAILABLE':
      return palette.success;
    case 'TAKEN':
      return colors.border;
    case 'MAINTENANCE':
      return palette.warning;
    case 'MINE':
      return colors.primary;
  }
}

/** Sorts spots for a fallback grid: numeric labels first, then alphabetically. */
function sortByLabel(spots: SpotDTO[]): SpotDTO[] {
  return [...spots].sort((a, b) => {
    const labelA = a.label ?? a.name;
    const labelB = b.label ?? b.name;
    const numA = Number(labelA);
    const numB = Number(labelB);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
    return labelA.localeCompare(labelB, 'tr');
  });
}

function formatDayTime(startTime: string | undefined, endTime: string | undefined, locale: string): string {
  if (!startTime || !endTime) return '';
  const start = new Date(startTime);
  const end = new Date(endTime);
  const day = start.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const startHour = start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const endHour = end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${startHour} - ${endHour}`;
}

interface SpotButtonProps {
  spot: SpotDTO;
  selected: boolean;
  onPress: () => void;
}

function SpotButton({ spot, selected, onPress }: SpotButtonProps) {
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const t = useT();
  const STATUS_LABELS = statusLabels(t);
  const disabled = spot.status !== 'AVAILABLE';
  const color = selected ? colors.primary : statusColor(spot.status, colors);
  const label = spot.label ?? spot.name;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mSessionBooking.a11y.spot', { name: spot.name, status: STATUS_LABELS[spot.status] })}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.spot,
        {
          borderColor: color,
          backgroundColor: selected ? color : 'transparent',
          opacity: spot.status === 'TAKEN' || spot.status === 'MAINTENANCE' ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[styles.spotLabel, fonts.bodyStrong, { color: selected ? onColor(color) : colors.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

interface SpotGroupViewProps {
  group: SpotGroupDTO;
  selectedSpotId: string | null;
  onSelect: (spotId: string) => void;
}

function SpotGroupView({ group, selectedSpotId, onSelect }: SpotGroupViewProps) {
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const hasCoordinates = group.spots.every((s) => s.layoutX !== null && s.layoutY !== null && s.layoutX !== undefined && s.layoutY !== undefined);

  if (hasCoordinates) {
    const maxX = Math.max(...group.spots.map((s) => s.layoutX as number));
    const maxY = Math.max(...group.spots.map((s) => s.layoutY as number));
    return (
      <View style={styles.groupBlock}>
        <Text style={[styles.groupTitle, fonts.bodyStrong, { color: colors.textPrimary }]}>{group.resourceTypeName}</Text>
        <View
          style={{
            width: (maxX + 1) * (SPOT_SIZE + SPOT_GAP),
            height: (maxY + 1) * (SPOT_SIZE + SPOT_GAP),
          }}
        >
          {group.spots.map((spot) => (
            <View
              key={spot.id}
              style={{
                position: 'absolute',
                left: (spot.layoutX as number) * (SPOT_SIZE + SPOT_GAP),
                top: (spot.layoutY as number) * (SPOT_SIZE + SPOT_GAP),
              }}
            >
              <SpotButton spot={spot} selected={selectedSpotId === spot.id} onPress={() => onSelect(spot.id)} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.groupBlock}>
      <Text style={[styles.groupTitle, fonts.bodyStrong, { color: colors.textPrimary }]}>{group.resourceTypeName}</Text>
      <View style={styles.wrapGrid}>
        {sortByLabel(group.spots).map((spot) => (
          <SpotButton key={spot.id} spot={spot} selected={selectedSpotId === spot.id} onPress={() => onSelect(spot.id)} />
        ))}
      </View>
    </View>
  );
}

function Legend() {
  const fonts = useThemeFonts();
  const colors = useThemeColors();
  const t = useT();
  const STATUS_LABELS = statusLabels(t);
  const items: { status: SpotStatus; label: string }[] = [
    { status: 'AVAILABLE', label: STATUS_LABELS.AVAILABLE },
    { status: 'TAKEN', label: STATUS_LABELS.TAKEN },
    { status: 'MAINTENANCE', label: STATUS_LABELS.MAINTENANCE },
    { status: 'MINE', label: STATUS_LABELS.MINE },
  ];
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.status} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: statusColor(item.status, colors) }]} />
          <Text style={[styles.legendLabel, fonts.body, { color: colors.textSecondary }]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Session detail and booking, with a spot map when the service has member-selectable resources. */
export default function SeansDetailScreen() {
  const params = useLocalSearchParams<{
    scheduleId: string;
    title?: string;
    serviceTypeName?: string;
    serviceTypeId?: string;
    trainerName?: string;
    startTime?: string;
    endTime?: string;
    capacity?: string;
    bookedCount?: string;
    deliveryMode?: string;
    studioId?: string;
  }>();
  const scheduleId = params.scheduleId;
  const fonts = useThemeFonts();
  const colors = useThemeColors();
  const { locale } = useLocale();
  const t = useT();
  const { activeMembership, memberships, refreshUser } = useSession();
  // A booking opened from the home list can belong to another business than the active one.
  const membership = (params.studioId ? memberships.find((m) => m.studioId === params.studioId) : null) ?? activeMembership;
  const studioId = membership?.studioId;
  const memberId = membership?.memberProfileId ?? null;

  const [spotsData, setSpotsData] = useState<ScheduleSpotsDTO | null>(null);
  const [packages, setPackages] = useState<MemberPackageDTO[] | null>(null);
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [isBooking, setIsBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [chargedPackage, setChargedPackage] = useState<BookingChargedPackageDTO | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | undefined>();
  const [selfStatus, setSelfStatus] = useState<ScheduleSelfStatusDTO | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isWaitlisting, setIsWaitlisting] = useState(false);

  const isOnline = params.deliveryMode === 'ONLINE' || params.deliveryMode === 'HYBRID';
  // Re-evaluated on every render so the button appears/disappears live as the clock crosses the window.
  const canJoinNow =
    isOnline && params.startTime && params.endTime
      ? isWithinJoinWindow(new Date(params.startTime), new Date(params.endTime), new Date())
      : false;

  const handleJoin = async () => {
    if (!studioId || !scheduleId) return;
    setIsJoining(true);
    setJoinError(undefined);
    try {
      const result = await apiRequest<JoinSessionResultDTO>(`/schedules/sessions/${scheduleId}/join`, {
        method: 'POST',
        studioId,
      });
      await openExternalUrl(result.joinUrl);
    } catch (e) {
      setJoinError(e instanceof ApiError ? e.message : t('mSessionBooking.errors.joinLinkFailed'));
    } finally {
      setIsJoining(false);
    }
  };

  const loadSpots = useCallback(async () => {
    if (!studioId || !scheduleId) return;
    try {
      const data = await apiRequest<ScheduleSpotsDTO>(`/schedules/${scheduleId}/spots`, { studioId });
      setSpotsData(data);
      setSelectedSpotId((prev) => {
        if (!prev) return prev;
        const stillAvailable = data.groups.some((g) => g.spots.some((s) => s.id === prev && s.status === 'AVAILABLE'));
        return stillAvailable ? prev : null;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mSessionBooking.errors.spotsLoadFailed'));
    }
  }, [scheduleId, studioId]);

  useEffect(() => {
    loadSpots();
  }, [loadSpots]);

  const loadSelfStatus = useCallback(async () => {
    if (!studioId || !scheduleId || !memberId) return;
    try {
      setSelfStatus(await apiRequest<ScheduleSelfStatusDTO>(`/schedules/${scheduleId}/self-status`, { studioId }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mSessionBooking.errors.statusLoadFailed'));
    }
  }, [scheduleId, studioId, memberId, t]);

  useEffect(() => {
    void loadSelfStatus();
  }, [loadSelfStatus]);

  useEffect(() => {
    if (!studioId || !params.serviceTypeId) return;
    apiRequest<MemberPackageDTO[]>(`/members/self/packages?serviceTypeId=${params.serviceTypeId}`, { studioId })
      .then(setPackages)
      .catch(() => setPackages([]));
  }, [studioId, params.serviceTypeId]);

  const hasSpots = (spotsData?.groups.length ?? 0) > 0;
  const needsSpotSelection = hasSpots && !selectedSpotId;

  const handleBook = async () => {
    if (!studioId || !memberId || !scheduleId) return;
    setIsBooking(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const created = await apiRequest<{ notices?: BookingNoticeDTO[]; chargedPackage?: BookingChargedPackageDTO | null }>(`/schedules/book/self`, {
        method: 'POST',
        studioId,
        body: {
          studioId,
          scheduleId,
          memberId,
          resourceIds: selectedSpotId ? [selectedSpotId] : [],
        },
      });
      setBooked(true);
      await loadSelfStatus();
      // The API picks the package (soonest-expiring usable one); show which one was charged.
      setChargedPackage(created.chargedPackage ?? null);
      // Non-blocking information from the API (e.g. a no-show inside the repeat window).
      setNotice(created.notices?.[0]?.message);
      await refreshUser();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setNotice(t('mSessionBooking.errors.spotTakenRetry'));
        setSelectedSpotId(null);
        await loadSpots();
      } else {
        setError(e instanceof ApiError ? e.message : t('mSessionBooking.errors.bookingFailed'));
      }
    } finally {
      setIsBooking(false);
    }
  };

  const runCancel = async (bookingId: string) => {
    if (!studioId) return;
    setIsCancelling(true);
    setError(undefined);
    try {
      const result = await apiRequest<{ message?: string }>('/schedules/cancel/self', {
        method: 'POST',
        studioId,
        body: { bookingId, cancelledBy: 'MEMBER' },
      });
      setBooked(false);
      setChargedPackage(null);
      setNotice(undefined);
      await Promise.all([loadSelfStatus(), loadSpots(), refreshUser()]);
      showNotice(t, t('mSessionBooking.cancel.doneTitle'), result.message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mSessionBooking.errors.cancelFailed'));
      await loadSelfStatus();
    } finally {
      setIsCancelling(false);
    }
  };

  const handleCancel = () => {
    const booking = selfStatus?.booking;
    if (!booking) return;
    const { title, message } = cancelConfirmation(booking.cancellation, t);
    confirmAction({
      title,
      message,
      confirmLabel: t('mSessionBooking.cancel.confirmAction'),
      cancelLabel: t('mSessionBooking.cancel.keep'),
      destructive: true,
      onConfirm: () => void runCancel(booking.bookingId),
    });
  };

  const handleJoinWaitlist = async () => {
    if (!studioId || !memberId || !scheduleId) return;
    setIsWaitlisting(true);
    setError(undefined);
    try {
      const entry = await apiRequest<{ placeInLine: number }>('/schedules/waitlist/self', {
        method: 'POST',
        studioId,
        body: { studioId, scheduleId, memberId },
      });
      await loadSelfStatus();
      showNotice(t, t('mSessionBooking.waitlist.joined', { position: entry.placeInLine }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mSessionBooking.errors.waitlistJoinFailed'));
      await loadSelfStatus();
    } finally {
      setIsWaitlisting(false);
    }
  };

  const runLeaveWaitlist = async (waitlistId: string) => {
    if (!studioId) return;
    setIsWaitlisting(true);
    setError(undefined);
    try {
      await apiRequest('/schedules/waitlist/leave/self', { method: 'POST', studioId, body: { waitlistId } });
      await loadSelfStatus();
      showNotice(t, t('mSessionBooking.waitlist.left'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mSessionBooking.errors.waitlistLeaveFailed'));
      await loadSelfStatus();
    } finally {
      setIsWaitlisting(false);
    }
  };

  const handleLeaveWaitlist = () => {
    const entry = selfStatus?.waitlist;
    if (!entry) return;
    confirmAction({
      title: t('mSessionBooking.waitlist.leaveConfirmTitle'),
      message: t('mSessionBooking.waitlist.leaveConfirmBody'),
      confirmLabel: t('mSessionBooking.waitlist.leave'),
      cancelLabel: t('mSessionBooking.cancel.keep'),
      destructive: true,
      onConfirm: () => void runLeaveWaitlist(entry.waitlistId),
    });
  };

  // Until the status loads (or if it fails) booking stays available, as before.
  const action = selfStatus ? availableAction(selfStatus) : 'BOOK';
  const myBooking = selfStatus?.booking ?? null;
  const myWaitlist = selfStatus?.waitlist ?? null;

  return (
    <ScreenContainer>
      <Text style={[styles.title, fonts.display, { color: colors.textPrimary }]}>{params.serviceTypeName ?? params.title}</Text>
      <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>
        {formatDayTime(params.startTime, params.endTime, locale)}
      </Text>
      {params.trainerName ? (
        <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>{params.trainerName}</Text>
      ) : null}

      {isOnline ? (
        <View style={styles.joinSection}>
          {canJoinNow ? (
            <>
              <PrimaryButton label={t('mSessionBooking.joinSession')} onPress={handleJoin} loading={isJoining} />
              {joinError ? <Text style={[styles.message, { color: palette.danger }]}>{joinError}</Text> : null}
            </>
          ) : (
            <Text style={[styles.subtitle, fonts.body, { color: colors.textSecondary }]}>
              {t('mSessionBooking.joinLinkAppearsLater')}
            </Text>
          )}
        </View>
      ) : null}

      {!spotsData ? <ActivityIndicator style={styles.loader} /> : null}

      {spotsData && hasSpots && action === 'BOOK' && !booked ? (
        <View style={styles.spotsSection}>
          <Legend />
          {spotsData.groups.map((group) => (
            <SpotGroupView
              key={group.resourceTypeId}
              group={group}
              selectedSpotId={selectedSpotId}
              onSelect={(id) => setSelectedSpotId((prev) => (prev === id ? null : id))}
            />
          ))}
        </View>
      ) : null}

      {chargedPackage ? (
        <Text style={[styles.packageInfo, fonts.body, { color: colors.textSecondary }]}>
          {chargedPackage.remainingUnits === null
            ? t('mSessionBooking.packageUsed', { name: chargedPackage.packageName })
            : t('mSessionBooking.packageUsedWithRemaining', {
                name: chargedPackage.packageName,
                remaining: chargedPackage.remainingUnits,
              })}
        </Text>
      ) : !booked && packages && packages.length === 0 ? (
        <Text style={[styles.packageInfo, fonts.body, { color: palette.warning }]}>{t('mSessionBooking.noActivePackage')}</Text>
      ) : null}

      {error ? <Text style={[styles.message, { color: palette.danger }]}>{error}</Text> : null}
      {notice ? <Text style={[styles.message, { color: palette.warning }]}>{notice}</Text> : null}
      {booked ? <Text style={[styles.message, { color: palette.success }]}>{t('mSessionBooking.bookingConfirmed')}</Text> : null}

      {myBooking ? (
        <>
          {!booked ? <Text style={[styles.message, fonts.body, { color: colors.textSecondary }]}>{t('mSessionBooking.cancel.statusBooked')}</Text> : null}
          <PrimaryButton label={t('mSessionBooking.cancel.button')} onPress={handleCancel} loading={isCancelling} variant="danger" />
        </>
      ) : null}

      {myWaitlist ? (
        <>
          <Text style={[styles.message, fonts.bodyStrong, { color: colors.textPrimary }]}>
            {myWaitlist.status === 'OFFERED' ? t('mSessionBooking.waitlist.offered') : t('mSessionBooking.waitlist.position', { position: myWaitlist.placeInLine })}
          </Text>
          <PrimaryButton label={t('mSessionBooking.waitlist.leave')} onPress={handleLeaveWaitlist} loading={isWaitlisting} variant="secondary" />
        </>
      ) : null}

      {action === 'WAITLIST_JOIN' ? (
        <>
          <Text style={[styles.message, fonts.body, { color: colors.textSecondary }]}>{t('mSessionBooking.waitlist.full')}</Text>
          <PrimaryButton label={t('mSessionBooking.waitlist.join')} onPress={handleJoinWaitlist} loading={isWaitlisting} disabled={!memberId} />
        </>
      ) : null}

      {action === 'BOOK' && !booked ? (
        <PrimaryButton
          label={t('mSessionBooking.book')}
          onPress={handleBook}
          loading={isBooking}
          disabled={!memberId || needsSpotSelection}
        />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, marginBottom: spacing[1] },
  subtitle: { fontSize: typography.size.sm, marginBottom: spacing[1] },
  loader: { marginTop: spacing[4] },
  joinSection: { marginTop: spacing[3], marginBottom: spacing[3] },
  spotsSection: { marginTop: spacing[4], marginBottom: spacing[4] },
  groupBlock: { marginBottom: spacing[4] },
  groupTitle: { fontSize: typography.size.md, marginBottom: spacing[2] },
  wrapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPOT_GAP },
  spot: {
    width: SPOT_SIZE,
    height: SPOT_SIZE,
    minWidth: 44,
    minHeight: TOUCH_TARGET,
    borderWidth: borderWidth * 2,
    borderRadius: SPOT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotLabel: { fontSize: typography.size.sm },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], marginBottom: spacing[3] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  legendDot: { width: spacing[3], height: spacing[3], borderRadius: radii.full },
  legendLabel: { fontSize: typography.size.xs },
  packageInfo: { fontSize: typography.size.sm, marginBottom: spacing[3] },
  message: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
