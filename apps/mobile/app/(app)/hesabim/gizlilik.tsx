import type { SelfErasureStatusDTO } from '@platform/shared';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { Text } from '../../../src/components/Text';
import { formatDate } from '../../../src/i18n/formatting';
import { useLocale, useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { borderWidth, palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';

/**
 * Hesabım > Gizlilik (KVKK/GDPR, docs/KVKK_SILME.md). The member asks for
 * the erasure of their personal data at the active business, sees the state
 * of the request and the studio's reason when it was rejected. The business
 * decides; an unhandled request is processed automatically after 30 days.
 */
export default function GizlilikScreen() {
  const colors = useThemeColors();
  const t = useT();
  const { locale } = useLocale();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [status, setStatus] = useState<SelfErasureStatusDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      setStatus(await apiRequest<SelfErasureStatusDTO>('/me/erasure', { studioId }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mErasure.errors.loadFailed'));
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRequest = async () => {
    if (!studioId) return;
    setBusy(true);
    setError(undefined);
    try {
      const request = await apiRequest<SelfErasureStatusDTO['request']>('/me/erasure', { method: 'POST', studioId, body: {} });
      setStatus({ request });
      setConfirming(false);
      setNotice(t('mErasure.request.sent'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mErasure.errors.requestFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return <ScreenContainer>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.textPrimary} />}</ScreenContainer>;
  }

  const request = status.request;
  const open = request?.status === 'PENDING' || request?.status === 'APPROVED';
  const statusText = request
    ? t(`mErasure.status.${request.status}`, { date: formatDate(request.dueAt, locale, { dateStyle: 'medium' }) })
    : null;

  return (
    <ScreenContainer>
      <Text style={[styles.lead, { color: colors.textSecondary }]}>{t('mErasure.lead')}</Text>

      {request ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t('mErasure.status.title')}</Text>
          <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{statusText}</Text>
          {request.status === 'REJECTED' && request.decisionNote ? (
            <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{t('mErasure.status.reason', { reason: request.decisionNote })}</Text>
          ) : null}
        </View>
      ) : null}

      {notice ? <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!open ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {confirming ? (
            <>
              <Text style={[styles.cardDescription, { color: palette.danger }]}>{t('mErasure.request.confirm')}</Text>
              <PrimaryButton label={t('mErasure.request.confirmYes')} variant="danger" onPress={handleRequest} loading={busy} />
              <PrimaryButton label={t('mErasure.request.cancel')} variant="secondary" onPress={() => setConfirming(false)} />
            </>
          ) : (
            <PrimaryButton label={t('mErasure.request.action')} variant="danger" onPress={() => setConfirming(true)} />
          )}
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  lead: {
    fontSize: typography.size.sm,
    marginBottom: spacing[4],
    lineHeight: 20,
  },
  card: {
    borderWidth: borderWidth,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[4],
    gap: spacing[2],
  },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  cardDescription: {
    fontSize: typography.size.sm,
    lineHeight: 18,
    marginBottom: spacing[3],
  },
  error: {
    color: palette.danger,
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
});
