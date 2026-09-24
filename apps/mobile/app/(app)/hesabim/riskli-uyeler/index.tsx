import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ChurnListResponseDTO, ChurnMemberSummaryDTO } from '@platform/shared';

import { ApiError, apiRequest } from '../../../../src/lib/api';
import { useSession } from '../../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../../src/theme';

const LEVEL_LABEL: Record<string, string> = { HIGH: 'Yüksek', MEDIUM: 'Orta', LOW: 'Düşük' };
const LEVEL_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const LEVEL_COLOR: Record<string, string> = { HIGH: palette.danger, MEDIUM: palette.warning, LOW: palette.success };

const dateLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('tr-TR') : 'Hiç gelmedi');

/** W12 mobile: HIGH then MEDIUM churn-risk members, top 2 reasons, quick "görüşüldü" action. */
export default function RiskliUyelerScreen() {
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [items, setItems] = useState<ChurnMemberSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const res = await apiRequest<ChurnListResponseDTO>(`/churn/studio/${studioId}/members?limit=100`);
      const risky = res.items
        .filter((m) => m.level === 'HIGH' || m.level === 'MEDIUM')
        .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.score - a.score);
      setItems(risky);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Riskli üyeler yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const markContacted = async (memberId: string) => {
    if (!studioId) return;
    setBusyMemberId(memberId);
    try {
      await apiRequest(`/churn/studio/${studioId}/members/${memberId}/contacted`, {
        method: 'POST',
        body: { note: 'Telefonla görüşüldü' },
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Görüşüldü olarak işaretlenemedi.');
    } finally {
      setBusyMemberId(null);
    }
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: theme.family.radii.card };

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Text style={[styles.caption, fonts.body, { color: c.textSecondary }]}>Yüksek ve orta riskli üyeler</Text>
      {!items && !error ? <ActivityIndicator style={styles.spinner} /> : null}
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      {items && items.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: c.textSecondary }]}>Riskli üye bulunmuyor.</Text>
      ) : null}

      {items?.map((m) => {
        const topReasons = [...m.reasons].sort((a, b) => b.points - a.points).slice(0, 2);
        const alreadyContactedToday = m.contactedAt ? new Date(m.contactedAt).toDateString() === new Date().toDateString() : false;
        return (
          <View key={m.memberId} style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
            <View style={styles.headerRow}>
              <Text style={[styles.name, fonts.display, { color: c.textPrimary }]} numberOfLines={1}>
                {m.firstName} {m.lastName}
              </Text>
              <View style={[styles.badge, { backgroundColor: LEVEL_COLOR[m.level] }]}>
                <Text style={styles.badgeText}>{LEVEL_LABEL[m.level]} - {m.score}</Text>
              </View>
            </View>
            {m.phone ? <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>{m.phone}</Text> : null}
            <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>Son katılım: {dateLabel(m.lastAttendedAt)}</Text>
            {topReasons.map((r) => (
              <Text key={r.key} style={[styles.reason, fonts.body, { color: c.textSecondary }]}>
                - {r.label}
              </Text>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${m.firstName} ${m.lastName} ile görüşüldü olarak işaretle`}
              disabled={busyMemberId === m.memberId}
              onPress={() => markContacted(m.memberId)}
              style={[styles.contactButton, { borderColor: c.primary, opacity: busyMemberId === m.memberId ? 0.6 : 1 }]}
            >
              <Text style={[fonts.bodyStrong, { color: c.primary }]}>
                {alreadyContactedToday ? 'Bugün görüşüldü' : 'Görüşüldü'}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  caption: { fontSize: typography.size.sm, marginBottom: spacing[1] },
  spinner: { marginTop: spacing[6] },
  empty: { fontSize: typography.size.md, marginTop: spacing[4] },
  card: { padding: spacing[4] },
  bordered: { borderWidth: 1 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1] },
  name: { fontSize: typography.size.lg, flexShrink: 1, marginRight: spacing[2] },
  badge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: 999 },
  badgeText: { color: '#FFFFFF', fontSize: typography.size.xs, fontWeight: typography.weight.bold },
  meta: { fontSize: typography.size.sm },
  reason: { fontSize: typography.size.sm, marginTop: spacing[1] },
  contactButton: {
    marginTop: spacing[3],
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
