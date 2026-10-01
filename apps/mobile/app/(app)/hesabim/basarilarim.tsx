import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';

import type { LeaderboardDTO, MyGamificationStatsDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { TOUCH_TARGET, borderWidth, palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';

const currentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/** Member self-service: streak, monthly goal, badges, leaderboard (W16). */
export default function BasarilarimScreen() {
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const t = useT();
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
      setError(e instanceof ApiError ? e.message : t('mAchievements.errors.loadFailed'));
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
      setError(e instanceof ApiError ? e.message : t('mAchievements.errors.goalSaveFailed'));
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
      setError(e instanceof ApiError ? e.message : t('mAchievements.errors.settingSaveFailed'));
    } finally {
      setTogglingOptIn(false);
    }
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: radii.md };
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
        <View style={[styles.card, card, styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mAchievements.streak')}</Text>
          <View style={styles.streakRow}>
            <View style={styles.streakItem}>
              <Text style={[styles.bigValue, fonts.display, { color: c.textPrimary }]}>{stats.currentStreakWeeks}</Text>
              <Text style={[styles.metricLabel, fonts.body, { color: c.textMuted }]}>{t('mAchievements.currentStreakWeeks')}</Text>
            </View>
            <View style={styles.streakItem}>
              <Text style={[styles.bigValue, fonts.display, { color: c.textPrimary }]}>{stats.bestStreakWeeks}</Text>
              <Text style={[styles.metricLabel, fonts.body, { color: c.textMuted }]}>{t('mAchievements.bestStreak')}</Text>
            </View>
            <View style={styles.streakItem}>
              <Text style={[styles.bigValue, fonts.display, { color: c.textPrimary }]}>{stats.totalAttendedSessions}</Text>
              <Text style={[styles.metricLabel, fonts.body, { color: c.textMuted }]}>{t('mAchievements.totalSessions')}</Text>
            </View>
          </View>
        </View>
      ) : null}

      {stats ? (
        <View style={[styles.card, card, styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mAchievements.thisMonthsGoal')}</Text>
          {stats.currentMonth.targetSessions ? (
            <>
              <Text style={[fonts.body, { color: c.textSecondary, marginBottom: spacing[2] }]}>
                {t('mAchievements.goalProgress', { progress: stats.currentMonth.progress, target: stats.currentMonth.targetSessions })}
                {stats.currentMonth.metGoal ? t('mAchievements.goalMetSuffix') : ''}
              </Text>
              <ProgressBar ratio={goalRatio} />
            </>
          ) : (
            <Text style={[fonts.body, { color: c.textMuted, marginBottom: spacing[2] }]}>{t('mAchievements.noGoalYet')}</Text>
          )}
          <View style={styles.goalRow}>
            <TextInput
              value={goalInput}
              onChangeText={setGoalInput}
              placeholder={t('mAchievements.monthlyGoalPlaceholder')}
              placeholderTextColor={c.textMuted}
              keyboardType="number-pad"
              style={[styles.goalInput, { borderColor: c.border, color: c.textPrimary }]}
              accessibilityLabel={t('mAchievements.a11y.monthlyGoalInput')}
            />
            <PrimaryButton label={t('mAchievements.save')} onPress={handleSaveGoal} loading={savingGoal} />
          </View>
        </View>
      ) : null}

      {stats ? (
        <View style={[styles.card, card, styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mAchievements.badges')}</Text>
          <View style={styles.badgeGrid}>
            {stats.earnedBadges.map((b) => (
              <View key={b.badgeDefinitionId} style={[styles.badge, styles.badgeEarned, { borderColor: c.primary, backgroundColor: c.surface }]}>
                <Text style={[fonts.bodyStrong, styles.badgeName, { color: c.textPrimary }]} numberOfLines={2}>
                  {b.name}
                </Text>
                <Text style={[styles.badgeMeta, fonts.body, { color: c.textMuted }]}>{t('mAchievements.earned')}</Text>
              </View>
            ))}
            {stats.nextBadges.map((b) => (
              <View key={b.badgeDefinitionId} style={[styles.badge, { borderColor: c.border, backgroundColor: c.background }]}>
                <Text style={[fonts.bodyStrong, styles.badgeName, { color: c.textSecondary }]} numberOfLines={2}>
                  {b.name}
                </Text>
                <Text style={[styles.badgeMeta, fonts.body, { color: c.textMuted }]}>{b.progressLabel}</Text>
                <View style={[styles.badgeProgressTrack, { backgroundColor: c.surfaceEmphasis }]}>
                  <View style={[styles.badgeProgressFill, { width: `${Math.round(b.progressRatio * 100)}%`, backgroundColor: c.primary }]} />
                </View>
              </View>
            ))}
          </View>
          {stats.earnedBadges.length === 0 && stats.nextBadges.length === 0 ? (
            <Text style={[fonts.body, { color: c.textMuted }]}>{t('mAchievements.noBadgesYet')}</Text>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.card, card, styles.bordered]}>
        <View style={styles.optInRow}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary, marginBottom: 0 }]}>{t('mAchievements.leaderboard')}</Text>
          <Switch
            value={stats?.leaderboardOptedIn ?? false}
            onValueChange={handleToggleOptIn}
            disabled={togglingOptIn}
            accessibilityLabel={t('mAchievements.a11y.appearOnLeaderboard')}
          />
        </View>
        <Text style={[fonts.body, styles.caption, { color: c.textMuted }]}>{t('mAchievements.leaderboardCaption')}</Text>
        {leaderboard && leaderboard.entries.length > 0 ? (
          leaderboard.entries.map((entry) => (
            <View key={`${entry.rank}-${entry.displayName}`} style={styles.leaderRow}>
              <Text style={[fonts.bodyStrong, styles.leaderRank, { color: c.textPrimary }]}>{entry.rank}</Text>
              <Text
                style={[fonts.body, styles.leaderName, { color: entry.isSelf ? c.primary : c.textPrimary }]}
                numberOfLines={1}
              >
                {entry.displayName}
                {entry.isSelf ? t('mAchievements.youSuffix') : ''}
              </Text>
              <Text style={[fonts.body, { color: c.textSecondary }]}>{t('mAchievements.sessionsCount', { count: entry.sessions })}</Text>
            </View>
          ))
        ) : (
          <Text style={[fonts.body, { color: c.textMuted, marginTop: spacing[2] }]}>{t('mAchievements.noRankingYet')}</Text>
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
  bordered: { borderWidth: borderWidth },
  title: { fontSize: typography.size.lg, marginBottom: spacing[2] },
  bigValue: { fontSize: typography.size.xl, fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: typography.size.xs, marginTop: 2, textAlign: 'center' },
  streakRow: { flexDirection: 'row', justifyContent: 'space-between' },
  streakItem: { alignItems: 'center', flex: 1 },
  barTrack: { height: spacing[2], borderRadius: radii.full, overflow: 'hidden' },
  barFill: { height: spacing[2], borderRadius: radii.full },
  goalRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2], alignItems: 'center' },
  goalInput: { flex: 1, borderWidth: borderWidth, borderRadius: radii.sm, paddingHorizontal: spacing[3], minHeight: TOUCH_TARGET },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  badge: { width: '47%', borderWidth: borderWidth, borderRadius: radii.md, padding: spacing[3] },
  badgeEarned: { borderWidth: borderWidth * 2 },
  badgeName: { fontSize: typography.size.sm, marginBottom: spacing[1] },
  badgeMeta: { fontSize: typography.size.xs, marginBottom: spacing[1] },
  badgeProgressTrack: { height: spacing[1], borderRadius: radii.full, overflow: 'hidden' },
  badgeProgressFill: { height: spacing[1], borderRadius: radii.full },
  optInRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1] },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[2] },
  leaderRank: { width: 24 },
  leaderName: { flex: 1 },
  errorText: { color: palette.danger, fontSize: typography.size.xs },
});
