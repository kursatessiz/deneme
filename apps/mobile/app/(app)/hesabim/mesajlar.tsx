import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { InAppMessageDTO, MemberChatDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { formatDateTime, useLocale, useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

/**
 * Hesabım > İşletmeye yaz (docs/MESAJLASMA.md, "Gelen kutusu"): the member's
 * chat with the studio. Messages land in the same staff inbox as WhatsApp
 * and SMS; staff replies show up here. In-app messages the studio sent
 * (channel IN_APP) are listed above the chat and marked read when shown.
 */
export default function MesajlarScreen() {
  const t = useT();
  const { locale } = useLocale();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [chat, setChat] = useState<MemberChatDTO | null>(null);
  const [inApp, setInApp] = useState<InAppMessageDTO[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const [nextChat, nextInApp] = await Promise.all([
        apiRequest<MemberChatDTO>(`/studios/${studioId}/messaging/self/chat`, { studioId }),
        apiRequest<{ items: InAppMessageDTO[] }>(`/studios/${studioId}/messaging/self/in-app`, { studioId }),
      ]);
      setChat(nextChat);
      setInApp(nextInApp.items);
      // Shown means read; failures here only leave the unread marker in place.
      await Promise.all(
        nextInApp.items
          .filter((m) => !m.readAt)
          .map((m) => apiRequest(`/studios/${studioId}/messaging/self/in-app/${m.id}/read`, { method: 'POST', studioId }).catch(() => undefined)),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mMessaging.loadError'));
    }
  }, [studioId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const send = async () => {
    const body = draft.trim();
    if (!studioId || !body) return;
    setSending(true);
    setError(undefined);
    try {
      const next = await apiRequest<MemberChatDTO>(`/studios/${studioId}/messaging/self/chat`, { method: 'POST', body: { body }, studioId });
      setChat(next);
      setDraft('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mMessaging.chat.sendError'));
    } finally {
      setSending(false);
    }
  };

  const bubble = { borderColor: c.border, borderRadius: theme.family.radii.card };

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      {inApp.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: c.textSecondary }]}>{t('mMessaging.chat.announcements')}</Text>
          {inApp.map((m) => (
            <View key={m.id} style={[styles.announcement, bubble, { backgroundColor: c.surface }]}>
              {m.subject ? <Text style={[styles.subject, fonts.bodyStrong, { color: c.textPrimary }]}>{m.subject}</Text> : null}
              <Text style={[styles.body, fonts.body, { color: c.textPrimary }]}>{m.body}</Text>
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{formatDateTime(m.createdAt, locale)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {!chat && !error ? <ActivityIndicator style={styles.spinner} /> : null}
      {chat && chat.messages.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: c.textSecondary }]}>{t('mMessaging.chat.empty')}</Text>
      ) : null}
      {chat?.messages.map((m) => {
        const mine = m.direction === 'IN';
        return (
          <View key={m.id} style={[styles.row, mine ? styles.rowEnd : styles.rowStart]}>
            <View style={[styles.bubble, bubble, { backgroundColor: mine ? c.surfaceMuted : c.surface }]}>
              <Text style={[styles.body, fonts.body, { color: c.textPrimary }]}>{m.body}</Text>
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>
                {mine ? t('mMessaging.chat.you') : (m.authorName ?? t('mMessaging.chat.studio'))} · {formatDateTime(m.createdAt, locale)}
              </Text>
            </View>
          </View>
        );
      })}

      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}

      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={t('mMessaging.chat.placeholder')}
        placeholderTextColor={c.textMuted}
        accessibilityLabel={t('mMessaging.chat.placeholder')}
        multiline
        maxLength={2000}
        style={[styles.input, fonts.body, { borderColor: c.border, color: c.textPrimary, backgroundColor: c.surface, borderRadius: theme.family.radii.input }]}
      />
      <PrimaryButton label={t('mMessaging.chat.send')} onPress={send} loading={sending} disabled={!draft.trim()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  section: { gap: spacing[2], marginBottom: spacing[2] },
  sectionTitle: { fontSize: typography.size.sm },
  announcement: { padding: spacing[3], borderWidth: 1, gap: spacing[1] },
  subject: { fontSize: typography.size.md },
  spinner: { marginTop: spacing[6] },
  empty: { fontSize: typography.size.md },
  row: { flexDirection: 'row' },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', padding: spacing[3], borderWidth: 1, gap: spacing[1] },
  body: { fontSize: typography.size.md },
  meta: { fontSize: typography.size.xs },
  input: { minHeight: 88, borderWidth: 1, padding: spacing[3], textAlignVertical: 'top', fontSize: typography.size.md },
});
