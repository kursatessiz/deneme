import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { AutomationRuleType } from '@platform/shared';

import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { SwitchRow } from '../../../src/components/SwitchRow';
import { useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { borderWidth, palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';
import type { Translate } from '@platform/shared';
import { Text } from '../../../src/components/Text';

/** Mirrors AutomationRule as returned by the API; @platform/database types stay server-side. */
interface AutomationRuleDTO {
  id: string;
  type: AutomationRuleType;
  name: string;
  isActive: boolean;
  isTransactional: boolean;
}

interface RuleStatsDTO {
  ruleId: string;
  sent: number;
  skipped: number;
  failed: number;
}

function ruleTypeLabels(t: Translate): Record<AutomationRuleType, string> {
  return {
    WIN_BACK: t('mAutomations.type.winBack'),
    PACKAGE_EXPIRING: t('mAutomations.type.packageExpiring'),
    BIRTHDAY: t('mAutomations.type.birthday'),
    FIRST_CLASS_FOLLOW_UP: t('mAutomations.type.firstClassFollowUp'),
    BOOKING_REMINDER: t('mAutomations.type.bookingReminder'),
    NO_SHOW_FOLLOW_UP: t('mAutomations.type.noShowFollowUp'),
  };
}

/** Owner screen: automated marketing/lifecycle rules, on/off, last-30-day counts. */
export default function OtomatikMesajlarScreen() {
  const colors = useThemeColors();
  const t = useT();
  const RULE_TYPE_LABELS = ruleTypeLabels(t);
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;
  const canManage = activeMembership?.permissions.includes('notifications.manage') ?? false;

  const [rules, setRules] = useState<AutomationRuleDTO[] | null>(null);
  const [stats, setStats] = useState<Record<string, RuleStatsDTO>>({});
  const [loadError, setLoadError] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studioId) return;
    setLoadError(undefined);
    try {
      const [rulesRes, statsRes] = await Promise.all([
        apiRequest<{ items: AutomationRuleDTO[] }>(`/studios/${studioId}/automation-rules`),
        apiRequest<{ items: RuleStatsDTO[] }>(`/studios/${studioId}/automation-rules/stats`),
      ]);
      setRules(rulesRes.items);
      setStats(Object.fromEntries(statsRes.items.map((s) => [s.ruleId, s])));
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('mAutomations.errors.loadFailed'));
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canManage) return <Redirect href="/(app)/hesabim" />;

  const handleToggle = async (rule: AutomationRuleDTO, nextValue: boolean) => {
    if (!studioId) return;
    setSaveError(undefined);
    setTogglingId(rule.id);
    const previous = rules;
    setRules((current) => current?.map((r) => (r.id === rule.id ? { ...r, isActive: nextValue } : r)) ?? current);
    try {
      await apiRequest(`/studios/${studioId}/automation-rules/${rule.id}/toggle`, {
        method: 'PATCH',
        body: { isActive: nextValue },
      });
    } catch (error) {
      setRules(previous);
      setSaveError(error instanceof ApiError ? error.message : t('mAutomations.errors.toggleFailed'));
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>{t('mAutomations.intro')}</Text>

      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
      {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
      {!rules && !loadError ? <ActivityIndicator color={colors.textPrimary} /> : null}

      {rules?.map((rule) => {
        const s = stats[rule.id];
        return (
          <View key={rule.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderText}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{rule.name}</Text>
                <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
                  {RULE_TYPE_LABELS[rule.type]}
                  {!rule.isTransactional ? t('mAutomations.marketingSuffix') : ''}
                </Text>
              </View>
              <SwitchRow
                label={t('mAutomations.activeLabel', { name: rule.name })}
                value={rule.isActive}
                onValueChange={(value) => handleToggle(rule, value)}
                disabled={togglingId === rule.id}
              />
            </View>

            <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.statText, { color: colors.textSecondary }]}>{t('mAutomations.last30Days')}</Text>
              <Text style={[styles.statValue, { color: palette.success }]}>{t('mAutomations.sentCount', { count: s?.sent ?? 0 })}</Text>
              <Text style={[styles.statValue, { color: colors.textMuted }]}>{t('mAutomations.skippedCount', { count: s?.skipped ?? 0 })}</Text>
              <Text style={[styles.statValue, { color: palette.danger }]}>{t('mAutomations.failedCount', { count: s?.failed ?? 0 })}</Text>
            </View>
          </View>
        );
      })}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: typography.size.sm,
    marginBottom: spacing[4],
  },
  error: {
    color: palette.danger,
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
  card: {
    borderWidth: borderWidth,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardHeaderText: {
    flex: 1,
    marginRight: spacing[3],
  },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[1],
  },
  cardSubtitle: {
    fontSize: typography.size.xs,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: borderWidth,
  },
  statText: {
    fontSize: typography.size.xs,
    marginRight: spacing[1],
  },
  statValue: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
});
