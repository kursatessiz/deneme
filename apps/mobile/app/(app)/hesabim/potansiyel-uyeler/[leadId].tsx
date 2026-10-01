import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { LeadStage, canTransitionLeadStage } from '@platform/shared';
import type { LeadDetailDTO } from '@platform/shared';

import { ChoiceRow } from '../../../../src/components/ChoiceRow';
import { PrimaryButton } from '../../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { TextField } from '../../../../src/components/TextField';
import { useLocale, useT } from '../../../../src/i18n';
import { ApiError, apiRequest } from '../../../../src/lib/api';
import { useSession } from '../../../../src/lib/session';
import { borderWidth, palette, spacing, typography, useTheme, useThemeFonts } from '../../../../src/theme';
import type { Translate } from '@platform/shared';
import { Text } from '../../../../src/components/Text';

function stageLabels(t: Translate): Record<string, string> {
  return {
    NEW: t('mLeads.stage.new'),
    CONTACTED: t('mLeads.stage.contacted'),
    TRIAL_BOOKED: t('mLeads.stage.trialBooked'),
    TRIAL_DONE: t('mLeads.stage.trialDone'),
    WON: t('mLeads.stage.won'),
    LOST: t('mLeads.stage.lost'),
  };
}

function activityLabels(t: Translate): Record<string, string> {
  return {
    NOTE: t('mLeads.activity.note'),
    CALL: t('mLeads.activity.call'),
    MESSAGE: t('mLeads.activity.message'),
    STAGE_CHANGE: t('mLeads.activity.stageChange'),
    TRIAL_BOOKED: t('mLeads.activity.trialBooked'),
  };
}

/** W11 mobile: lead detail with quick actions for staff who have leads.view/manage. */
export default function LeadDetailScreen() {
  const { leadId } = useLocalSearchParams<{ leadId: string }>();
  const router = useRouter();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const { locale } = useLocale();
  const t = useT();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;
  const canManage = activeMembership?.permissions.includes('leads.manage') ?? false;

  const [lead, setLead] = useState<LeadDetailDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [noteBody, setNoteBody] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [pendingStage, setPendingStage] = useState<LeadStage | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!studioId || !leadId) return;
    setError(undefined);
    try {
      const res = await apiRequest<LeadDetailDTO>(`/leads/${leadId}/studio/${studioId}`, { studioId });
      setLead(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mLeads.errors.detailLoadFailed'));
    }
  }, [studioId, leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const addNote = async () => {
    if (!studioId || !leadId || !noteBody.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiRequest(`/leads/${leadId}/activities`, {
        method: 'POST',
        body: { type: 'NOTE', body: noteBody.trim() },
        studioId,
      });
      setNoteBody('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mLeads.errors.noteAddFailed'));
    } finally {
      setBusy(false);
    }
  };

  const changeStage = async (nextStage: LeadStage) => {
    if (!studioId || !leadId) return;
    if (nextStage === LeadStage.LOST && !lostReason.trim()) {
      setPendingStage(nextStage);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await apiRequest(`/leads/${leadId}/stage`, {
        method: 'POST',
        body: { stage: nextStage, lostReason: nextStage === LeadStage.LOST ? lostReason.trim() : undefined },
        studioId,
      });
      setPendingStage(null);
      setLostReason('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mLeads.errors.stageChangeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!studioId || !leadId) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiRequest(`/leads/${leadId}/convert`, { method: 'POST', body: {}, studioId });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mLeads.errors.convertFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!lead) {
    return (
      <ScreenContainer>
        {error ? <Text style={{ color: palette.danger }}>{error}</Text> : <ActivityIndicator />}
      </ScreenContainer>
    );
  }

  const nextStages = Object.values(LeadStage).filter((s) => canTransitionLeadStage(lead.stage as LeadStage, s));
  const isClosed = lead.stage === LeadStage.WON || lead.stage === LeadStage.LOST;

  return (
    <ScreenContainer>
      <Text style={[styles.name, fonts.display, { color: c.textPrimary }]}>{lead.fullName}</Text>
      <Text style={[styles.stage, fonts.bodyStrong, { color: c.primaryText }]}>{stageLabels(t)[lead.stage] ?? lead.stage}</Text>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mLeads.call')}</Text>
        {/* Selectable text, not a tel: link: staff dial from their own phone app. */}
        <Text selectable style={[styles.phone, fonts.body, { color: c.textPrimary }]}>
          {lead.phone}
        </Text>
        {lead.email ? <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>{lead.email}</Text> : null}
      </View>

      {error ? <Text style={{ color: palette.danger, marginBottom: spacing[3] }}>{error}</Text> : null}

      {canManage && !isClosed ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mLeads.addNote')}</Text>
          <TextField label={t('mLeads.noteLabel')} value={noteBody} onChangeText={setNoteBody} placeholder={t('mLeads.notePlaceholder')} />
          <PrimaryButton label={t('mLeads.saveNote')} onPress={addNote} loading={busy} disabled={!noteBody.trim()} />
        </View>
      ) : null}

      {canManage && !isClosed && nextStages.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mLeads.changeStage')}</Text>
          {nextStages.map((s) => (
            <ChoiceRow
              key={s}
              label={stageLabels(t)[s] ?? s}
              selected={pendingStage === s}
              onPress={() => changeStage(s)}
              disabled={busy}
            />
          ))}
          {pendingStage === LeadStage.LOST ? (
            <View style={styles.lostReason}>
              <TextField
                label={t('mLeads.lostReasonLabel')}
                value={lostReason}
                onChangeText={setLostReason}
                placeholder={t('mLeads.lostReasonPlaceholder')}
              />
              <PrimaryButton
                label={t('mLeads.markLost')}
                variant="danger"
                onPress={() => changeStage(LeadStage.LOST)}
                loading={busy}
                disabled={!lostReason.trim()}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {canManage && !isClosed ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mLeads.convertToMemberSection')}</Text>
          <PrimaryButton label={t('mLeads.convert')} onPress={convert} loading={busy} />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mLeads.history')}</Text>
        {lead.activities.length === 0 ? (
          <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{t('mLeads.noRecords')}</Text>
        ) : null}
        {lead.activities.map((a) => (
          <View key={a.id} style={[styles.activityRow, { borderColor: c.border }]}>
            <Text style={[styles.activityType, fonts.bodyStrong, { color: c.textPrimary }]}>
              {activityLabels(t)[a.type] ?? a.type}
            </Text>
            <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>{a.body}</Text>
            <Text style={[styles.activityMeta, fonts.body, { color: c.textMuted }]}>
              {a.actorName ?? t('mLeads.webForm')} · {new Date(a.createdAt).toLocaleString(locale)}
            </Text>
          </View>
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: typography.size.xl, marginBottom: spacing[1] },
  stage: { fontSize: typography.size.sm, marginBottom: spacing[5] },
  section: { marginBottom: spacing[6] },
  sectionTitle: { fontSize: typography.size.sm, marginBottom: spacing[2] },
  phone: { fontSize: typography.size.lg },
  meta: { fontSize: typography.size.sm },
  lostReason: { marginTop: spacing[2] },
  activityRow: { borderTopWidth: borderWidth, paddingVertical: spacing[3] },
  activityType: { fontSize: typography.size.sm, marginBottom: spacing[1] },
  activityMeta: { fontSize: typography.size.xs, marginTop: spacing[1] },
});
