import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MemberPackageDTO, MemberVideoContentDTO } from '@platform/shared';

import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../../src/theme';

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${minutes} dk`;
}

/**
 * Member video library: grid of published on-demand content, filterable by
 * service type, with resume position and a clear reason when a card is
 * locked. Playback opens the source link externally (Linking) rather than
 * an in-app player - no expo-av/expo-video dependency exists in this
 * project yet, see docs/VIDEO.md.
 */
export default function VideolarScreen() {
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [items, setItems] = useState<MemberVideoContentDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [serviceTypeFilter, setServiceTypeFilter] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const res = await apiRequest<MemberVideoContentDTO[]>('/video/content/self', { studioId });
      setItems(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Videolar yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const serviceTypes = useMemo(() => {
    const map = new Map<string, string>();
    (items ?? []).forEach((i) => {
      if (i.serviceTypeId && i.serviceTypeName) map.set(i.serviceTypeId, i.serviceTypeName);
    });
    return [...map.entries()];
  }, [items]);

  const visible = useMemo(
    () => (serviceTypeFilter ? (items ?? []).filter((i) => i.serviceTypeId === serviceTypeFilter) : (items ?? [])),
    [items, serviceTypeFilter],
  );

  const handleWatch = async (item: MemberVideoContentDTO) => {
    if (!studioId || item.isLocked) return;
    setStartingId(item.id);
    setError(undefined);
    try {
      let memberPackageId: string | undefined;
      if (item.creditCost && !item.isCreditCharged) {
        // Credit-based content needs a package to charge; use the member's
        // first active credit-eligible package (kept simple - staff can
        // guide members with several such packages).
        const packages = await apiRequest<MemberPackageDTO[]>(`/members/self/packages?serviceTypeId=${item.serviceTypeId ?? ''}`, {
          studioId,
        }).catch(() => []);
        memberPackageId = packages.find((p) => p.entitlementKind === 'CREDIT')?.id;
      }
      const result = await apiRequest<{ content: { sourceUrl: string | null } }>(`/video/content/self/${item.id}/start`, {
        method: 'POST',
        studioId,
        body: { memberPackageId },
      });
      if (result.content.sourceUrl) {
        await Linking.openURL(result.content.sourceUrl);
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Video açılamadı.');
    } finally {
      setStartingId(null);
    }
  };

  return (
    <ScreenContainer>
      {serviceTypes.length > 0 ? (
        <View style={styles.filterRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tümü"
            onPress={() => setServiceTypeFilter(null)}
            style={[styles.chip, { borderColor: !serviceTypeFilter ? colors.primary : colors.border, backgroundColor: !serviceTypeFilter ? colors.primary : 'transparent' }]}
          >
            <Text style={{ color: !serviceTypeFilter ? colors.surface : colors.textPrimary, fontSize: typography.size.xs }}>Tümü</Text>
          </Pressable>
          {serviceTypes.map(([id, name]) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={name}
              onPress={() => setServiceTypeFilter(id)}
              style={[styles.chip, { borderColor: serviceTypeFilter === id ? colors.primary : colors.border, backgroundColor: serviceTypeFilter === id ? colors.primary : 'transparent' }]}
            >
              <Text style={{ color: serviceTypeFilter === id ? colors.surface : colors.textPrimary, fontSize: typography.size.xs }}>{name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!items && !error ? <ActivityIndicator style={styles.loader} /> : null}
      {error ? <Text style={[styles.message, { color: palette.danger }]}>{error}</Text> : null}
      {items?.length === 0 ? (
        <Text style={[styles.message, fonts.body, { color: colors.textSecondary }]}>Henüz video içeriği yok.</Text>
      ) : null}

      <View style={styles.grid}>
        {visible.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.isLocked ? `${item.title}, kilitli: ${item.lockedReason}` : item.title}
            disabled={item.isLocked || startingId === item.id}
            onPress={() => handleWatch(item)}
            style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface, opacity: item.isLocked ? 0.6 : 1 }]}
          >
            <Text style={[styles.cardTitle, fonts.bodyStrong, { color: colors.textPrimary }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.cardMeta, fonts.body, { color: colors.textSecondary }]}>
              {formatDuration(item.durationSeconds)}
              {item.serviceTypeName ? ` · ${item.serviceTypeName}` : ''}
            </Text>
            {item.isLocked ? (
              <Text style={[styles.cardLocked, { color: palette.warning }]}>{item.lockedReason}</Text>
            ) : item.lastPositionSeconds ? (
              <Text style={[styles.cardMeta, { color: colors.primary }]}>
                Kaldığın yer: {formatDuration(item.lastPositionSeconds)}
              </Text>
            ) : null}
            {item.completedAt ? <Text style={[styles.cardMeta, { color: palette.success }]}>Tamamlandı</Text> : null}
            {startingId === item.id ? <ActivityIndicator style={styles.cardLoader} /> : null}
          </Pressable>
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[4] },
  chip: { minHeight: 36, paddingHorizontal: spacing[3], justifyContent: 'center', borderRadius: radii.md, borderWidth: 1 },
  loader: { marginTop: spacing[4] },
  message: { fontSize: typography.size.sm, marginBottom: spacing[3] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  card: {
    width: '47%',
    minHeight: 96,
    padding: spacing[3],
    borderWidth: 1,
    borderRadius: radii.md,
    gap: 4,
  },
  cardTitle: { fontSize: typography.size.sm },
  cardMeta: { fontSize: typography.size.xs },
  cardLocked: { fontSize: typography.size.xs },
  cardLoader: { marginTop: spacing[1] },
});
