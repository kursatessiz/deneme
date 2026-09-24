import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { LeaderboardDTO, MyGamificationStatsDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const currentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/** Member self-service: streak, monthly goal, badges, leaderboard (W16). */
export default function BasarilarimScreen() {
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [stats, setStats] = useState<MyGamificationStatsDTO | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);
  const [togglingOptIn, setTogglingOptIn] = useState(false);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const [s, lb] = await Promise.all([
        apiRequest<MyGamificationStatsDTO>(`/gamification/studio/${studioId}/me/stats`),
        apiRequest<LeaderboardDTO>(`/gamification/studio/${studioId}/leaderboard?month=${currentMonthKey()}`),
      ]);
      setStats(s);
      setLeaderboard(lb);
      setGoalInput(s.currentMonth.targetSessions ? String(s.currentMonth.targetSessions) : '');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Başarılar yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveGoal = async () => {
    if (!studioId) return;
    const target = Number(goalInput);
    if (!Number.isInteger(target) || target <= 0) return;
    setSavingGoal(true);
    try {
      const updated = await apiRequest<MyGamificationStatsDTO>(`/gamification/studio/${studioId}/me/goal`, {
        method: 'PUT',
        body: { month: currentMonthKey(), targetSessions: target },
      });
      setStats(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Hedef kaydedilemedi.');
    } finally {
      setSavingGoal(false);
    }
  };

  const handleToggleOptIn = async (value: boolean) => {
    if (!studioId) return;
    setTogglingOptIn(true);
    try {
      await apiRequest(`/gamification/studio/${studioId}/me/leaderboard-opt-in`, { method: 'PUT', body: { optedIn: value } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ayar kaydedilemedi.');
    } finally {
      setTogglingOptIn(false);
    }
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: theme.family.radii.card };
  const goalRatio = stats?.currentMonth.targetSessions
    ? Math.max(0, Math.min(1, stats.currentMonth.progress / stats.currentMonth.targetSessions))
    : 0;

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
      {!stats && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {stats ? (
        <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>Seri</Text>
          <View style={styles.streakRow}>
            <View style={styles.streakItem}>
              <Text style={[styles.bigValue, fonts.display, { color: c.textPrimary }]}>{stats.currentStreakWeeks}</Text>
              <Text style={[styles.metricLabel, fonts.body, { color: c.textMuted }]}>Güncel hafta serisi</Text>
            </View>
            <View style={styles.streakItem}>
              <Text style={[styles.bigValue, fonts.display, { color: c.textPrimary }]}>{stats.bestStreakWeeks}</Text>
              <Text style={[styles.metricLabel, fonts.body, { color: c.textMuted }]}>En iyi seri</Text>
            </View>
            <View style={styles.streakItem}>
              <Text style={[styles.bigValue, fonts.display, { color: c.textPrimary }]}>{stats.totalAttendedSessions}</Text>
              <Text style={[styles.metricLabel, fonts.body, { color: c.textMuted }]}>Toplam seans</Text>
            </View>
          </View>
        </View>
      ) : null}

      {stats ? (
        <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>Bu ayın hedefi</Text>
          {stats.currentMonth.targetSessions ? (
            <>
              <Text style={[fonts.body, { color: c.textSecondary, marginBottom: spacing[2] }]}>
                {stats.currentMonth.progress} / {stats.currentMonth.targetSessions} seans
                {stats.currentMonth.metGoal ? ' — hedef tamamlandı' : ''}
              </Text>
              <ProgressBar ratio={goalRatio} />
            </>
          ) : (
            <Text style={[fonts.body, { color: c.textMuted, marginBottom: spacing[2] }]}>Bu ay için henüz bir hedef belirlemediniz.</Text>
          )}
          <View style={styles.goalRow}>
            <TextInput
              value={goalInput}
              onChangeText={setGoalInput}
              placeholder="Aylık hedef (seans)"
              placeholderTextColor={c.textMuted}
              keyboardType="number-pad"
              style={[styles.goalInput, { borderColor: c.border, color: c.textPrimary }]}
              accessibilityLabel="Aylık hedef seans sayısı"
            />
            <PrimaryButton label="Kaydet" onPress={handleSaveGoal} loading={savingGoal} />
          </View>
        </View>
      ) : null}

      {stats ? (
        <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>Rozetler</Text>
          <View style={styles.badgeGrid}>
            {stats.earnedBadges.map((b) => (
              <View key={b.badgeDefinitionId} style={[styles.badge, styles.badgeEarned, { borderColor: c.primary, backgroundColor: c.surface }]}>
                <Text style={[fonts.bodyStrong, styles.badgeName, { color: c.textPrimary }]} numberOfLines={2}>
                  {b.name}
                </Text>
                <Text style={[styles.badgeMeta, fonts.body, { color: c.textMuted }]}>Kazanıldı</Text>
              </View>
            ))}
            {stats.nextBadges.map((b) => (
              <View key={b.badgeDefinitionId} style={[styles.badge, { borderColor: c.border, backgroundColor: c.background }]}>
                <Text style={[fonts.bodyStrong, styles.badgeName, { color: c.textSecondary }]} numberOfLines={2}>
                  {b.name}
                </Text>
                <Text style={[styles.badgeMeta, fonts.body, { color: c.textMuted }]}>{b.progressLabel}</Text>
                <View style={styles.badgeProgressTrack}>
                  <View style={[styles.badgeProgressFill, { width: `${Math.round(b.progressRatio * 100)}%`, backgroundColor: c.primary }]} />
                </View>
              </View>
            ))}
          </View>
          {stats.earnedBadges.length === 0 && stats.nextBadges.length === 0 ? (
            <Text style={[fonts.body, { color: c.textMuted }]}>Henüz rozet tanımı yok.</Text>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
        <View style={styles.optInRow}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary, marginBottom: 0 }]}>Liderlik tablosu</Text>
          <Switch
            value={stats?.leaderboardOptedIn ?? false}
            onValueChange={handleToggleOptIn}
            disabled={togglingOptIn}
            accessibilityLabel="Liderlik tablosunda görün"
          />
        </View>
        <Text style={[fonts.body, styles.caption, { color: c.textMuted }]}>
          Katılırsanız adınız (soyadınızın ilk harfiyle) bu ayki en çok seans yapan üyeler arasında görünür.
        </Text>
        {leaderboard && leaderboard.entries.length > 0 ? (
          leaderboard.entries.map((entry) => (
            <View key={`${entry.rank}-${entry.displayName}`} style={styles.leaderRow}>
              <Text style={[fonts.bodyStrong, styles.leaderRank, { color: c.textPrimary }]}>{entry.rank}</Text>
              <Text
                style={[fonts.body, styles.leaderName, { color: entry.isSelf ? c.primary : c.textPrimary }]}
                numberOfLines={1}
              >
                {entry.displayName}
                {entry.isSelf ? ' (siz)' : ''}
              </Text>
              <Text style={[fonts.body, { color: c.textSecondary }]}>{entry.sessions} seans</Text>
            </View>
          ))
        ) : (
          <Text style={[fonts.body, { color: c.textMuted, marginTop: spacing[2] }]}>Bu ay henüz sıralama yok.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function ProgressBar({ ratio }: { ratio: number }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <View style={[styles.barTrack, { backgroundColor: c.border }]}>
      <View style={[styles.barFill, { width: `${clamped * 100}%`, backgroundColor: c.primary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  caption: { fontSize: typography.size.sm },
  card: { padding: spacing[4] },
  bordered: { borderWidth: 1 },
  title: { fontSize: typography.size.lg, marginBottom: spacing[2] },
  bigValue: { fontSize: typography.size.xl, fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: typography.size.xs, marginTop: 2, textAlign: 'center' },
  streakRow: { flexDirection: 'row', justifyContent: 'space-between' },
  streakItem: { alignItems: 'center', flex: 1 },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  goalRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2], alignItems: 'center' },
  goalInput: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: spacing[3], minHeight: 44 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  badge: { width: '47%', borderWidth: 1, borderRadius: 8, padding: spacing[3] },
  badgeEarned: { borderWidth: 2 },
  badgeName: { fontSize: typography.size.sm, marginBottom: spacing[1] },
  badgeMeta: { fontSize: typography.size.xs, marginBottom: spacing[1] },
  badgeProgressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(128,128,128,0.25)' },
  badgeProgressFill: { height: 4, borderRadius: 2 },
  optInRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1] },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[2] },
  leaderRank: { width: 24 },
  leaderName: { flex: 1 },
  errorText: { color: palette.danger, fontSize: typography.size.xs },
});
