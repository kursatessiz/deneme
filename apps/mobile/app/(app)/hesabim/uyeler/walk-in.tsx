import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { BookSessionSchema, firstIssueMessage } from '@platform/shared';
import type { BookingChargedPackageDTO, BookingNoticeDTO } from '@platform/shared';

import { PermissionGate } from '../../../../src/components/PermissionGate';
import { Chip } from '../../../../src/components/Chip';
import { PrimaryButton } from '../../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { formatDate, useLocale, useT } from '../../../../src/i18n';
import { ApiError, apiRequest } from '../../../../src/lib/api';
import { repeatIntervalConflict } from '../../../../src/lib/bookingOverride';
import { weekRange } from '../../../../src/lib/dateRange';
import { showNotice } from '../../../../src/lib/notice';
import { trainerName, type ScheduleRow } from '../../../../src/lib/scheduleTypes';
import { useSession } from '../../../../src/lib/session';
import { borderWidth, palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../../../src/theme';
import { Text } from '../../../../src/components/Text';

function formatDayTime(startTime: string, endTime: string, locale: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const day = start.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const startHour = start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const endHour = end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${startHour}-${endHour}`;
}

/** Package select values: '' lets the API pick, NO_CHARGE sends chargePackage:false. */
const AUTO_PACKAGE = '';
const NO_CHARGE_PACKAGE = '__no_charge__';

interface MemberPackageOption {
  id: string;
  name: string;
  entitlementKind: string;
  remainingUnits: number | null;
}

interface MemberDetailPackages {
  packages: {
    id: string;
    status: string;
    endDate: string;
    entitlementKind: string;
    remainingUnits?: number | null;
    packageDefinition?: { name: string } | null;
  }[];
}

function WalkInContent() {
  const router = useRouter();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { locale } = useLocale();
  const t = useT();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [packages, setPackages] = useState<MemberPackageOption[] | null>(null);
  const [packageChoice, setPackageChoice] = useState(AUTO_PACKAGE);
  const [charged, setCharged] = useState<BookingChargedPackageDTO | null>(null);

  const load = useCallback(async () => {
    if (!studioId) return;
    const { start, end } = weekRange(new Date());
    try {
      const data = await apiRequest<ScheduleRow[]>(
        `/schedules/studio/${studioId}?startDate=${start.toISOString()}&endDate=${end.toISOString()}`,
        { studioId },
      );
      setSchedules(data.filter((s) => !s.isCancelled && s.bookedCount < s.capacity));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mWalkIn.errors.sessionsLoadFailed'));
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  // The member's usable packages for the picker. Without members.view the picker offers only
  // "automatic" and "no package", and the API still decides.
  useEffect(() => {
    if (!studioId || !memberId) return;
    apiRequest<MemberDetailPackages>(`/members/${memberId}/studio/${studioId}`, { studioId })
      .then((detail) => {
        const now = Date.now();
        setPackages(
          detail.packages
            .filter(
              (p) =>
                p.status === 'ACTIVE' &&
                new Date(p.endDate).getTime() > now &&
                (p.entitlementKind === 'TIME_UNLIMITED' || (p.remainingUnits ?? 0) > 0),
            )
            .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
            .map((p) => ({
              id: p.id,
              name: p.packageDefinition?.name ?? '',
              entitlementKind: p.entitlementKind,
              remainingUnits: p.remainingUnits ?? null,
            })),
        );
      })
      .catch(() => setPackages(null));
  }, [studioId, memberId]);

  const book = async (scheduleId: string, overrideRepeatInterval = false) => {
    if (!studioId) return;
    setBusyId(scheduleId);
    setError(undefined);
    const parsed = BookSessionSchema.safeParse({
      studioId,
      scheduleId,
      memberId,
      resourceIds: [],
      ...(packageChoice === NO_CHARGE_PACKAGE
        ? { chargePackage: false }
        : packageChoice !== AUTO_PACKAGE
          ? { memberPackageId: packageChoice }
          : {}),
      ...(overrideRepeatInterval ? { overrideRepeatInterval: true } : {}),
    });
    if (!parsed.success) {
      setError(firstIssueMessage(parsed.error, t) ?? t('mWalkIn.errors.bookingFailed'));
      setBusyId(null);
      return;
    }
    try {
      const created = await apiRequest<{ notices?: BookingNoticeDTO[]; chargedPackage?: BookingChargedPackageDTO | null }>('/schedules/book', { method: 'POST', studioId, body: parsed.data });
      setDone(scheduleId);
      setCharged(created.chargedPackage ?? null);
      // Non-blocking information from the API (e.g. a no-show inside the repeat window).
      for (const notice of created.notices ?? []) {
        showNotice(t, t('mWalkIn.noticeTitle'), notice.message);
      }
    } catch (e) {
      const conflict = overrideRepeatInterval ? null : repeatIntervalConflict(e);
      if (conflict) {
        const date = formatDate(conflict.date, locale);
        Alert.alert(t('mWalkIn.repeatOverride.title'), t('mWalkIn.repeatOverride.body', { count: conflict.count, date }), [
          { text: t('mWalkIn.repeatOverride.cancel'), style: 'cancel' },
          { text: t('mWalkIn.repeatOverride.confirm'), onPress: () => void book(scheduleId, true) },
        ]);
      } else {
        setError(e instanceof ApiError ? e.message : t('mWalkIn.errors.bookingFailed'));
      }
    } finally {
      setBusyId(null);
    }
  };

  if (done) {
    return (
      <ScreenContainer>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t('mWalkIn.bookingCreated')}</Text>
        <Text style={[styles.lead, fonts.body, { color: colors.textSecondary }]}>
          {charged
            ? charged.remainingUnits === null
              ? t('mWalkIn.charged', { name: charged.packageName })
              : t('mWalkIn.chargedWithRemaining', { name: charged.packageName, remaining: charged.remainingUnits })
            : t('mWalkIn.notCharged')}
        </Text>
        <PrimaryButton label={t('mWalkIn.backToMemberCard')} onPress={() => router.back()} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t('mWalkIn.title')}</Text>
      <Text style={[styles.lead, fonts.body, { color: colors.textSecondary }]}>{t('mWalkIn.lead')}</Text>
      <Text style={[styles.rowTitle, fonts.bodyStrong, { color: colors.textPrimary }]}>{t('mWalkIn.package.label')}</Text>
      <View style={styles.chips}>
        <Chip label={t('mWalkIn.package.auto')} selected={packageChoice === AUTO_PACKAGE} onPress={() => setPackageChoice(AUTO_PACKAGE)} />
        {packages?.map((pkg) => (
          <Chip
            key={pkg.id}
            label={
              pkg.entitlementKind === 'TIME_UNLIMITED'
                ? t('mWalkIn.package.unlimited', { name: pkg.name })
                : t('mWalkIn.package.units', { name: pkg.name, remaining: pkg.remainingUnits ?? 0 })
            }
            selected={packageChoice === pkg.id}
            onPress={() => setPackageChoice(pkg.id)}
          />
        ))}
        <Chip label={t('mWalkIn.package.none')} selected={packageChoice === NO_CHARGE_PACKAGE} onPress={() => setPackageChoice(NO_CHARGE_PACKAGE)} />
      </View>
      {packages?.length === 0 ? (
        <Text style={[styles.rowMeta, fonts.body, { color: palette.warning }]}>{t('mWalkIn.package.noUsableHint')}</Text>
      ) : null}
      {!schedules && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
      {schedules?.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: colors.textSecondary }]}>{t('mWalkIn.noAvailableSessions')}</Text>
      ) : null}
      {schedules?.map((item) => (
        <View key={item.id} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, fonts.bodyStrong, { color: colors.textPrimary }]}>
              {item.serviceType?.name ?? item.title}
            </Text>
            <Text style={[styles.rowMeta, fonts.body, { color: colors.textSecondary }]}>
              {formatDayTime(item.startTime, item.endTime, locale)}
            </Text>
            {trainerName(item.trainer) ? (
              <Text style={[styles.rowMeta, fonts.body, { color: colors.textSecondary }]}>{trainerName(item.trainer)}</Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busyId === item.id}
            onPress={() => book(item.id)}
            style={[styles.bookButton, { borderColor: colors.primary }]}
          >
            <Text style={{ color: colors.primaryText, fontSize: typography.size.sm }}>{t('mWalkIn.add')}</Text>
          </Pressable>
        </View>
      ))}
    </ScreenContainer>
  );
}

/** Reception walk-in booking from the member card, against the existing POST /schedules/book (bookings.manage). */
export default function WalkInScreen() {
  return (
    <PermissionGate anyOf={['bookings.manage']}>
      <WalkInContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, marginBottom: spacing[1] },
  lead: { fontSize: typography.size.sm, marginBottom: spacing[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    borderRadius: radii.md,
    borderWidth: borderWidth,
    marginBottom: spacing[2],
  },
  rowText: { flex: 1, gap: 2, marginRight: spacing[2] },
  rowTitle: { fontSize: typography.size.md },
  rowMeta: { fontSize: typography.size.sm },
  bookButton: { minHeight: 40, paddingHorizontal: spacing[3], justifyContent: 'center', borderRadius: radii.sm, borderWidth: borderWidth },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginVertical: spacing[2] },
  empty: { fontSize: typography.size.sm },
  error: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
