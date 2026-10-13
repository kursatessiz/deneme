import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { firstIssueMessage } from '@platform/shared';
import type { InvitePreviewDTO } from '@platform/shared';

import { Card } from '../../src/components/Card';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { Text } from '../../src/components/Text';
import { TextField } from '../../src/components/TextField';
import { useT } from '../../src/i18n';
import { ApiError, apiRequest } from '../../src/lib/api';
import { buildAcceptBody, isInviteToken } from '../../src/lib/inviteLink';
import { useSession } from '../../src/lib/session';
import { palette, spacing, typography, useThemeColors, useThemeFonts } from '../../src/theme';

/**
 * In-app landing of the universal invite link `/j/<token>` (CLAUDE.md onboarding: phone code -> PIN ->
 * consent -> ACTIVE). Mirrors the web page apps/web/src/app/(app)/j/[token]: the same endpoints and the
 * same shared body schema; an unknown, expired or used invite shows one "not found" state because the
 * API answers all three the same way. The web page stays the fallback when the app is not installed.
 */
export default function JoinInviteScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const t = useT();
  const { acceptInvite } = useSession();
  const { token: tokenParam } = useLocalSearchParams<{ token: string }>();
  const token = isInviteToken(tokenParam) ? tokenParam : null;

  const [invite, setInvite] = useState<InvitePreviewDTO | null>(null);
  const [invalid, setInvalid] = useState(token === null);
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiRequest<InvitePreviewDTO>(`/invites/${encodeURIComponent(token)}`, { auth: false })
      .then(setInvite)
      .catch(() => setInvalid(true));
  }, [token]);

  const run = async (action: () => Promise<void>) => {
    setError(undefined);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('joinInvite.failed'));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      if (!token) return;
      const res = await apiRequest<{ phoneMasked: string }>(`/invites/${encodeURIComponent(token)}/otp`, { method: 'POST', auth: false });
      setPhoneMasked(res.phoneMasked);
    });

  const submit = () =>
    run(async () => {
      if (!token || !invite) return;
      const built = buildAcceptBody({ code, pin, documentIds: invite.documents.map((d) => d.id), device: `mobile-${Platform.OS}` });
      if (!built.ok) {
        setError(firstIssueMessage({ issues: built.issues }, t) ?? t('joinInvite.failed'));
        return;
      }
      await acceptInvite(token, built.body);
      router.replace('/(app)');
    });

  if (invalid) {
    return (
      <ScreenContainer>
        <Text style={[styles.message, fonts.body, { color: palette.danger }]}>{t('joinInvite.invalid')}</Text>
        <PrimaryButton label={t('joinInvite.goToLogin')} onPress={() => router.replace('/')} variant="secondary" />
      </ScreenContainer>
    );
  }

  if (!invite) {
    return (
      <ScreenContainer>
        <ActivityIndicator color={colors.textPrimary} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={[styles.title, fonts.display, { color: colors.textPrimary }]}>{t('joinInvite.invitedTo', { name: invite.studio.name })}</Text>
      <Text style={[styles.message, fonts.body, { color: colors.textSecondary }]}>{t('joinInvite.role', { role: invite.roleName })}</Text>
      <Text style={[styles.message, fonts.body, { color: colors.textPrimary }]}>{t('joinInvite.greeting', { fullName: invite.fullName })}</Text>

      {!phoneMasked ? (
        <>
          {error ? <Text style={[styles.message, { color: palette.danger }]}>{error}</Text> : null}
          <PrimaryButton label={t('joinInvite.sendCode')} onPress={sendCode} loading={busy} />
        </>
      ) : (
        <View>
          <Text style={[styles.message, fonts.body, { color: colors.textSecondary }]}>{t('joinInvite.codeSentTo', { phone: phoneMasked })}</Text>
          <TextField label={t('joinInvite.code')} value={code} onChangeText={setCode} placeholder="123456" keyboardType="number-pad" maxLength={6} />
          <TextField label={t('joinInvite.pin')} value={pin} onChangeText={setPin} placeholder="••••••" keyboardType="number-pad" secureTextEntry maxLength={6} />
          <Text style={[styles.hint, fonts.body, { color: colors.textMuted }]}>{t('joinInvite.pinHint')}</Text>

          <Text style={[styles.section, fonts.bodyStrong, { color: colors.textPrimary }]}>{t('joinInvite.documents')}</Text>
          {invite.documents.map((d) => (
            <Card key={d.id} style={styles.document}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: openDocumentId === d.id }}
                onPress={() => setOpenDocumentId((current) => (current === d.id ? null : d.id))}
              >
                <Text style={[fonts.bodyStrong, { color: colors.textPrimary }]}>{d.title}</Text>
              </Pressable>
              {openDocumentId === d.id ? <Text style={[styles.documentBody, fonts.body, { color: colors.textSecondary }]}>{d.body}</Text> : null}
            </Card>
          ))}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            onPress={() => setAccepted((value) => !value)}
            style={styles.acceptRow}
          >
            <View style={[styles.box, { borderColor: colors.border, backgroundColor: accepted ? colors.primary : 'transparent' }]} />
            <Text style={[styles.acceptLabel, fonts.body, { color: colors.textPrimary }]}>{t('joinInvite.accept')}</Text>
          </Pressable>

          {error ? <Text style={[styles.message, { color: palette.danger }]}>{error}</Text> : null}
          <PrimaryButton label={busy ? t('joinInvite.submitting') : t('joinInvite.submit')} onPress={submit} loading={busy} disabled={!accepted || code.length !== 6} />
          <View style={styles.spacer} />
          <PrimaryButton label={t('joinInvite.sendCode')} onPress={sendCode} disabled={busy} variant="secondary" />
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, marginBottom: spacing[2] },
  message: { fontSize: typography.size.sm, marginBottom: spacing[3] },
  hint: { fontSize: typography.size.xs, marginBottom: spacing[4] },
  section: { fontSize: typography.size.md, marginBottom: spacing[2] },
  document: { marginBottom: spacing[2] },
  documentBody: { fontSize: typography.size.sm, marginTop: spacing[2] },
  acceptRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing[3], marginVertical: spacing[3] },
  box: { width: 24, height: 24, borderWidth: 2, borderRadius: 6 },
  acceptLabel: { flex: 1, fontSize: typography.size.sm },
  spacer: { height: spacing[3] },
});
