import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { APPROVAL_NOTE_MAX } from '@platform/shared';
import type { ApprovalListDTO, ApprovalRequestDTO, MessageKey } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { TextField } from '../../../src/components/TextField';
import { formatDate, useLocale, useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { usePlatformAccess } from '../../../src/lib/platformContext';
import { useSession } from '../../../src/lib/session';
import { borderWidth, palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';
import { Text } from '../../../src/components/Text';

type DecisionAction = 'approve' | 'reject';

/**
 * Pending marketing approval requests of the platform (M5). Lists what the
 * push notification announced (campaign name, channels, audience, requester,
 * expiry) and lets an authorised user approve or reject through the same
 * endpoints as the web queue: POST /platform/marketing/approvals/:id/approve
 * and /reject. The API decides who may act (four-eyes rule, super admin), the
 * screen only offers the buttons when the request says canDecide. Reaching it
 * needs the platform permission platform.marketing.approve.
 */
export default function PazarlamaOnaylariScreen() {
  const colors = useThemeColors();
  const t = useT();
  const { locale } = useLocale();
  const { user } = useSession();
  const platform = usePlatformAccess(user?.isSuperAdmin ?? false);
  const canApprove = platform.permissions.includes('platform.marketing.approve');

  const [list, setList] = useState<ApprovalListDTO | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [decision, setDecision] = useState<{ id: string; action: DecisionAction } | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      setList(await apiRequest<ApprovalListDTO>('/platform/marketing/approvals?status=PENDING&limit=50'));
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('mMarketingApprovals.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    if (canApprove) load();
  }, [canApprove, load]);

  if (platform.ready && !canApprove) return <Redirect href="/(app)/hesabim" />;
  if (!platform.ready) {
    return (
      <ScreenContainer>
        <ActivityIndicator color={colors.primary} />
      </ScreenContainer>
    );
  }

  const open = (id: string, action: DecisionAction) => {
    setDecision({ id, action });
    setNote('');
    setNoteError(undefined);
    setFeedback(null);
  };

  const submit = async () => {
    if (!decision) return;
    const trimmed = note.trim();
    // The API requires a reason for a rejection (the requester sees it); an approval note is optional.
    if (decision.action === 'reject' && trimmed.length === 0) {
      setNoteError(t('mMarketingApprovals.note.rejectRequired'));
      return;
    }
    setBusy(true);
    try {
      await apiRequest<ApprovalRequestDTO>(`/platform/marketing/approvals/${decision.id}/${decision.action}`, {
        method: 'POST',
        body: trimmed.length > 0 ? { note: trimmed } : {},
      });
      setFeedback({ tone: 'success', text: t(decision.action === 'approve' ? 'mMarketingApprovals.approved' : 'mMarketingApprovals.rejected') });
      setDecision(null);
      await load();
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof ApiError ? error.message : t('mMarketingApprovals.actionFailed') });
    } finally {
      setBusy(false);
    }
  };

  const channelsOf = (request: ApprovalRequestDTO): string => {
    const channels = request.summary.channels.length > 0 ? request.summary.channels : request.summary.target.channel ? [request.summary.target.channel] : [];
    if (channels.length === 0) return t('mMarketingApprovals.channel.none');
    return channels.map((c) => t(`mMarketingApprovals.channel.${c}` as MessageKey)).join(', ');
  };

  const reasonsOf = (request: ApprovalRequestDTO): string => request.summary.reasons.map((r) => t(`marketingApprovals.reason.${r}` as MessageKey)).join(', ');

  const items = list?.items ?? [];

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t('mMarketingApprovals.title')}</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>{t('mMarketingApprovals.intro')}</Text>

      {!list && !loadError && <ActivityIndicator color={colors.primary} />}
      {loadError && <Text style={{ color: palette.danger, marginBottom: spacing[3] }}>{loadError}</Text>}
      {feedback && <Text style={{ color: feedback.tone === 'success' ? colors.textPrimary : palette.danger, marginBottom: spacing[3] }}>{feedback.text}</Text>}
      {list && items.length === 0 && <Text style={{ color: colors.textSecondary, marginBottom: spacing[3] }}>{t('mMarketingApprovals.empty')}</Text>}

      {items.map((request) => {
        const active = decision?.id === request.id ? decision : null;
        const reasons = reasonsOf(request);
        return (
          <View key={request.id} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.name, { color: colors.textPrimary }]}>{request.summary.target.name}</Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>{t('mMarketingApprovals.field.channel', { channels: channelsOf(request) })}</Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>{t('mMarketingApprovals.field.audience', { count: request.summary.audience.total })}</Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>{t('mMarketingApprovals.field.requestedBy', { name: request.requestedBy.name })}</Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>
              {t('mMarketingApprovals.field.expiresAt', { date: formatDate(request.expiresAt, locale, { dateStyle: 'medium', timeStyle: 'short' }) })}
            </Text>
            {reasons.length > 0 && <Text style={[styles.detail, { color: colors.textMuted }]}>{t('mMarketingApprovals.field.reasons', { reasons })}</Text>}

            {!request.canDecide && <Text style={[styles.detail, { color: colors.textMuted }]}>{t('mMarketingApprovals.ownRequest')}</Text>}

            {request.canDecide && !active && (
              <View style={styles.actions}>
                <PrimaryButton label={t('mMarketingApprovals.approve')} onPress={() => open(request.id, 'approve')} />
                <PrimaryButton label={t('mMarketingApprovals.reject')} onPress={() => open(request.id, 'reject')} variant="danger" />
              </View>
            )}

            {request.canDecide && active && (
              <View style={styles.form}>
                <TextField
                  label={t(active.action === 'approve' ? 'mMarketingApprovals.note.approve' : 'mMarketingApprovals.note.reject')}
                  value={note}
                  onChangeText={(value) => {
                    setNote(value);
                    setNoteError(undefined);
                  }}
                  maxLength={APPROVAL_NOTE_MAX}
                  errorMessage={noteError}
                />
                <View style={styles.actions}>
                  <PrimaryButton
                    label={t(active.action === 'approve' ? 'mMarketingApprovals.confirmApprove' : 'mMarketingApprovals.confirmReject')}
                    onPress={submit}
                    loading={busy}
                    variant={active.action === 'approve' ? 'primary' : 'danger'}
                  />
                  <PrimaryButton label={t('mMarketingApprovals.cancel')} onPress={() => setDecision(null)} disabled={busy} variant="secondary" />
                </View>
              </View>
            )}
          </View>
        );
      })}

      <PrimaryButton label={t('mMarketingApprovals.refresh')} onPress={load} variant="secondary" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, marginBottom: spacing[2] },
  description: { fontSize: typography.size.sm, marginBottom: spacing[4] },
  row: { borderWidth: borderWidth, borderRadius: radii.md, padding: spacing[3], marginBottom: spacing[3] },
  name: { fontSize: typography.size.md, fontWeight: typography.weight.semibold, marginBottom: spacing[1] },
  detail: { fontSize: typography.size.sm, marginBottom: spacing[1] },
  actions: { gap: spacing[2], marginTop: spacing[2] },
  form: { marginTop: spacing[2] },
});
