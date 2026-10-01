import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { LeadStage } from '@platform/shared';
import type { LeadDTO, LeadListResponseDTO } from '@platform/shared';

import { useLocale, useT } from '../../../../src/i18n';
import { ApiError, apiRequest } from '../../../../src/lib/api';
import { useSession } from '../../../../src/lib/session';
import { borderWidth, palette, radii, spacing, TOUCH_TARGET, typography, useTheme, useThemeFonts } from '../../../../src/theme';
import type { Translate } from '@platform/shared';
import { Text } from '../../../../src/components/Text';

function stages(t: Translate): { key: LeadStage; label: string }[] {
  return [
    { key: LeadStage.NEW, label: t('mLeads.stage.new') },
    { key: LeadStage.CONTACTED, label: t('mLeads.stage.contacted') },
    { key: LeadStage.TRIAL_BOOKED, label: t('mLeads.stage.trialBooked') },
    { key: LeadStage.TRIAL_DONE, label: t('mLeads.stage.trialDone') },
    { key: LeadStage.WON, label: t('mLeads.stage.won') },
    { key: LeadStage.LOST, label: t('mLeads.stage.lost') },
  ];
}

/** W11: staff with leads.view browse the lead pipeline by stage. */
export default function PotansiyelUyelerScreen() {
  const router = useRouter();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const { locale } = useLocale();
  const t = useT();
  const STAGES = stages(t);
  const dateLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale) : null);
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [stage, setStage] = useState<LeadStage>(LeadStage.NEW);
  const [counts, setCounts] = useState<Partial<Record<LeadStage, number>>>({});
  const [items, setItems] = useState<LeadDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const loadCounts = useCallback(async () => {
    if (!studioId) return;
    try {
      const results = await Promise.all(
        STAGES.map((s) =>
          apiRequest<LeadListResponseDTO>(`/leads/studio/${studioId}?stage=${s.key}&limit=1`, { studioId }),
        ),
      );
      const next: Partial<Record<LeadStage, number>> = {};
      STAGES.forEach((s, i) => {
        next[s.key] = results[i].total;
      });
      setCounts(next);
    } catch {
      // Counts are a convenience; the stage list below still loads on its own.
    }
  }, [studioId]);

  const loadItems = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const res = await apiRequest<LeadListResponseDTO>(
        `/leads/studio/${studioId}?stage=${stage}&limit=50`,
        { studioId },
      );
      setItems(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mLeads.errors.listLoadFailed'));
    }
  }, [studioId, stage]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    setItems(null);
    loadItems();
  }, [loadItems]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadCounts(), loadItems()]);
    setRefreshing(false);
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: radii.md };

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsRow}>
        {STAGES.map((s) => {
          const selected = s.key === stage;
          return (
            <Pressable
              key={s.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={
                counts[s.key] !== undefined ? t('mLeads.a11y.stageTabWithCount', { label: s.label, count: counts[s.key] as number }) : s.label
              }
              onPress={() => setStage(s.key)}
              style={[
                styles.tab,
                { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primary : c.surface },
              ]}
            >
              <Text style={[styles.tabLabel, fonts.bodyStrong, { color: selected ? theme.colors.background : c.textPrimary }]}>
                {s.label}
                {counts[s.key] !== undefined ? ` (${counts[s.key]})` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!items && !error ? <ActivityIndicator style={styles.spinner} /> : null}
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      {items && items.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: c.textSecondary }]}>{t('mLeads.noLeadsInStage')}</Text>
      ) : null}

      {items?.map((lead) => {
        const followUp = dateLabel(lead.nextFollowUpAt);
        return (
          <Pressable
            key={lead.id}
            accessibilityRole="button"
            accessibilityLabel={t('mLeads.a11y.openDetail', { name: lead.fullName })}
            onPress={() => router.push(`/(app)/hesabim/potansiyel-uyeler/${lead.id}`)}
            style={[styles.card, card, styles.bordered]}
          >
            <Text style={[styles.name, fonts.display, { color: c.textPrimary }]}>{lead.fullName}</Text>
            <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>{lead.phone}</Text>
            {lead.ownerName ? (
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{t('mLeads.ownerLabel', { name: lead.ownerName })}</Text>
            ) : null}
            {followUp ? (
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{t('mLeads.followUpLabel', { date: followUp })}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  tabsRow: { flexGrow: 0, marginBottom: spacing[3] },
  tab: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    marginRight: spacing[2],
    borderRadius: radii.full,
    borderWidth: borderWidth,
  },
  tabLabel: { fontSize: typography.size.sm },
  spinner: { marginTop: spacing[6] },
  empty: { fontSize: typography.size.md, marginTop: spacing[4] },
  card: { padding: spacing[4] },
  bordered: { borderWidth: borderWidth },
  name: { fontSize: typography.size.lg, marginBottom: spacing[1] },
  meta: { fontSize: typography.size.sm },
});
