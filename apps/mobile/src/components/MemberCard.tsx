import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ChurnMemberSummaryDTO, MemberDetailDTO, MemberPackageDTO } from '@platform/shared';

import { ApiError, apiRequest } from '../lib/api';
import { useSession } from '../lib/session';
import { palette, radii, spacing, typography, useTheme, useThemeColors, useThemeFonts } from '../theme';
import { GradientSurface } from './GradientSurface';
import { MemberHealthTrendCard } from './MemberHealthTrendCard';
import { PackageCard } from './PackageCard';
import { PrimaryButton } from './PrimaryButton';

const RISK_LABEL: Record<string, string> = { HIGH: 'Yüksek risk', MEDIUM: 'Orta risk', LOW: 'Düşük risk' };
const RISK_COLOR: Record<string, string> = { HIGH: palette.danger, MEDIUM: palette.warning, LOW: palette.success };

const BOOKING_STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Onaylı',
  ATTENDED: 'Katıldı',
  CANCELLED_EARLY: 'İptal',
  CANCELLED_LATE: 'Geç iptal',
  NO_SHOW: 'Gelmedi',
  WAITLIST: 'Bekleme listesi',
};

interface BookingHistoryRow {
  id: string;
  status: keyof typeof BOOKING_STATUS_LABEL;
  createdAt: string;
  schedule?: { title?: string; startTime?: string; trainer?: { membership?: { user?: { firstName: string; lastName: string } } } };
}

interface MemberCardProps {
  memberId: string;
  onChanged?: () => void;
}

/**
 * Staff member card (W2/W21): profile, masked contact, active packages
 * (package-card gradient), freeze/unfreeze, booking history, W12 risk
 * badge, partner-guest label, W21 health trend, notes. Shared between the
 * phone push screen and the tablet two-pane member list.
 */
export function MemberCard({ memberId, onChanged }: MemberCardProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;
  const canViewHealth = activeMembership?.permissions.includes('members.health.view') ?? false;
  const canSellPackages = activeMembership?.permissions.includes('packages.sell') ?? false;
  const canBookWalkIn = activeMembership?.permissions.includes('bookings.manage') ?? false;

  const [detail, setDetail] = useState<MemberDetailDTO | null>(null);
  const [risk, setRisk] = useState<ChurnMemberSummaryDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busyPackageId, setBusyPackageId] = useState<string | null>(null);
  const [freezeDays, setFreezeDays] = useState('7');

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const data = await apiRequest<MemberDetailDTO>(`/members/${memberId}/studio/${studioId}`, { studioId });
      setDetail(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Üye bilgileri yüklenemedi.');
    }
    // Risk snapshot may not exist yet (e.g. never computed for this studio); that stays a quiet no-op.
    apiRequest<ChurnMemberSummaryDTO>(`/churn/studio/${studioId}/members/${memberId}`, { studioId })
      .then(setRisk)
      .catch(() => setRisk(null));
  }, [memberId, studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const freeze = async (packageId: string) => {
    if (!studioId) return;
    const days = Number(freezeDays);
    if (!Number.isInteger(days) || days <= 0) {
      setError('Geçerli bir gün sayısı giriniz.');
      return;
    }
    setBusyPackageId(packageId);
    try {
      await apiRequest(`/members/packages/${packageId}/freeze`, { method: 'POST', studioId, body: { studioId, days } });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Paket dondurulamadı.');
    } finally {
      setBusyPackageId(null);
    }
  };

  const unfreeze = async (packageId: string) => {
    if (!studioId) return;
    setBusyPackageId(packageId);
    try {
      await apiRequest(`/members/packages/${packageId}/unfreeze`, { method: 'POST', studioId, body: { studioId } });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Dondurma kaldırılamadı.');
    } finally {
      setBusyPackageId(null);
    }
  };

  if (!detail && !error) return <ActivityIndicator style={styles.loader} />;
  if (error && !detail) return <Text style={[styles.error, { color: palette.danger }]}>{error}</Text>;
  if (!detail) return null;

  const bookings = (detail.bookings as BookingHistoryRow[]) ?? [];

  return (
    <View>
      <GradientSurface slot="memberCard" style={[styles.header, { borderRadius: theme.family.radii.card }]}>
        <Text style={[styles.name, fonts.display, { color: '#FFFFFF' }]} numberOfLines={1}>
          {detail.firstName} {detail.lastName}
        </Text>
        <View style={styles.badgeRow}>
          {risk ? (
            <View style={[styles.badge, { backgroundColor: RISK_COLOR[risk.level] }]}>
              <Text style={styles.badgeText}>{RISK_LABEL[risk.level]}</Text>
            </View>
          ) : null}
          {detail.isPartnerGuest ? (
            <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Text style={styles.badgeText}>Partner misafiri</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.contact, fonts.body, { color: 'rgba(255,255,255,0.85)' }]}>
          {detail.phone ?? 'Telefon: iletişim izniniz yok'}
        </Text>
        {detail.email ? <Text style={[styles.contact, fonts.body, { color: 'rgba(255,255,255,0.85)' }]}>{detail.email}</Text> : null}
      </GradientSurface>

      <View style={styles.quickActions}>
        {canBookWalkIn ? (
          <PrimaryButton
            label="Seansa ekle (walk-in)"
            variant="secondary"
            onPress={() => router.push({ pathname: '/(app)/hesabim/uyeler/walk-in', params: { memberId } })}
          />
        ) : null}
        {canSellPackages ? (
          <PrimaryButton
            label="Paket sat"
            variant="secondary"
            onPress={() => router.push({ pathname: '/(app)/hesabim/uyeler/paket-sat', params: { memberId } })}
          />
        ) : null}
      </View>

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

      {risk && risk.reasons.length > 0 ? (
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: colors.textPrimary }]}>Risk nedenleri</Text>
          {[...risk.reasons]
            .sort((a, b) => b.points - a.points)
            .slice(0, 3)
            .map((r) => (
              <Text key={r.key} style={[styles.reason, fonts.body, { color: colors.textSecondary }]}>
                - {r.label}
              </Text>
            ))}
        </View>
      ) : null}

      <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: colors.textPrimary, marginTop: spacing[4] }]}>
        Aktif paketler
      </Text>
      {detail.packages.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: colors.textSecondary }]}>Aktif paket yok.</Text>
      ) : null}
      {(detail.packages as MemberPackageDTO[]).map((pkg) => (
        <View key={pkg.id}>
          <PackageCard pkg={pkg} />
          {canSellPackages && pkg.status === 'ACTIVE' ? (
            <View style={styles.freezeRow}>
              <TextInput
                accessibilityLabel="Dondurma gün sayısı"
                keyboardType="number-pad"
                value={freezeDays}
                onChangeText={setFreezeDays}
                style={[styles.freezeInput, { borderColor: colors.border, color: colors.textPrimary }]}
              />
              <PrimaryButton
                label="Dondur"
                variant="secondary"
                loading={busyPackageId === pkg.id}
                onPress={() => freeze(pkg.id)}
              />
            </View>
          ) : null}
          {canSellPackages && pkg.status === 'FROZEN' ? (
            <PrimaryButton
              label="Dondurmayı kaldır"
              variant="secondary"
              loading={busyPackageId === pkg.id}
              onPress={() => unfreeze(pkg.id)}
            />
          ) : null}
        </View>
      ))}

      {canViewHealth ? <MemberHealthTrendCard memberId={memberId} /> : null}

      <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: colors.textPrimary, marginTop: spacing[4] }]}>
        Rezervasyon geçmişi
      </Text>
      {bookings.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: colors.textSecondary }]}>Rezervasyon bulunmuyor.</Text>
      ) : null}
      {bookings.slice(0, 20).map((b) => (
        <View key={b.id} style={[styles.historyRow, { borderColor: colors.border }]}>
          <Text style={[styles.historyTitle, fonts.body, { color: colors.textPrimary }]} numberOfLines={1}>
            {b.schedule?.title ?? 'Seans'}
          </Text>
          <Text style={[styles.historyMeta, fonts.body, { color: colors.textMuted }]}>
            {b.schedule?.startTime ? new Date(b.schedule.startTime).toLocaleDateString('tr-TR') : ''} ·{' '}
            {BOOKING_STATUS_LABEL[b.status] ?? b.status}
          </Text>
        </View>
      ))}

      {detail.notes ? (
        <>
          <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: colors.textPrimary, marginTop: spacing[4] }]}>
            Notlar
          </Text>
          <Text style={[styles.notes, fonts.body, { color: colors.textSecondary }]}>{detail.notes}</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: spacing[8] },
  header: { padding: spacing[4], marginBottom: spacing[4], gap: spacing[1] },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[4] },
  name: { fontSize: typography.size.xl },
  badgeRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[1] },
  badge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radii.full },
  badgeText: { color: '#FFFFFF', fontSize: typography.size.xs, fontWeight: typography.weight.bold },
  contact: { fontSize: typography.size.sm },
  section: { borderWidth: 1, borderRadius: radii.md, padding: spacing[3], marginBottom: spacing[3] },
  sectionTitle: { fontSize: typography.size.md, marginBottom: spacing[2] },
  reason: { fontSize: typography.size.sm, marginTop: 2 },
  empty: { fontSize: typography.size.sm, marginBottom: spacing[3] },
  freezeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  freezeInput: { minHeight: 44, width: 64, borderWidth: 1, borderRadius: radii.md, textAlign: 'center', paddingHorizontal: spacing[2] },
  historyRow: { borderBottomWidth: 1, paddingVertical: spacing[2] },
  historyTitle: { fontSize: typography.size.sm },
  historyMeta: { fontSize: typography.size.xs },
  notes: { fontSize: typography.size.sm, marginBottom: spacing[4] },
  error: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
