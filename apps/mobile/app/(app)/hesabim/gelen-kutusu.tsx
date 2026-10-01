import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import type { ConversationDetailDTO, ConversationSummaryDTO } from '@platform/shared';

import { PermissionGate } from '../../../src/components/PermissionGate';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { formatDateTime, useLocale, useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { isTabletWidth } from '../../../src/lib/layout';
import { useSession } from '../../../src/lib/session';
import { borderWidth, palette, radii, spacing, TOUCH_TARGET, typography, useTheme, useThemeFonts } from '../../../src/theme';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';

/**
 * Hesabım > Gelen kutusu (reception and owner, inbox.view): open
 * conversations from WhatsApp, SMS and the member app. Tablet shows the
 * list and the conversation side by side; phone shows one at a time.
 * Free-text replies only; outside WhatsApp's 24-hour window the web panel's
 * approved-template reply is used (the API enforces the rule either way).
 */
export default function GelenKutusuScreen() {
  return (
    <PermissionGate anyOf={['inbox.view']}>
      <Inbox />
    </PermissionGate>
  );
}

function Inbox() {
  const t = useT();
  const { locale } = useLocale();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const { width } = useWindowDimensions();
  const isTablet = isTabletWidth(width);
  const studioId = activeMembership?.studioId;
  const permissions = activeMembership?.permissions ?? [];
  const canReply = permissions.includes('inbox.reply');
  const canManage = permissions.includes('inbox.manage');

  const [items, setItems] = useState<ConversationSummaryDTO[] | null>(null);
  const [selected, setSelected] = useState<ConversationDetailDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadList = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const res = await apiRequest<{ items: ConversationSummaryDTO[] }>(`/studios/${studioId}/inbox/conversations?status=OPEN&take=50`, { studioId });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mMessaging.loadError'));
    }
  }, [studioId, t]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const open = async (id: string) => {
    if (!studioId) return;
    setError(undefined);
    setDraft('');
    try {
      setSelected(await apiRequest<ConversationDetailDTO>(`/studios/${studioId}/inbox/conversations/${id}`, { studioId }));
      loadList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mMessaging.loadError'));
    }
  };

  const reply = async () => {
    const body = draft.trim();
    if (!studioId || !selected || !body) return;
    setBusy(true);
    setError(undefined);
    try {
      setSelected(
        await apiRequest<ConversationDetailDTO>(`/studios/${studioId}/inbox/conversations/${selected.id}/reply`, {
          method: 'POST',
          body: { body },
          studioId,
        }),
      );
      setDraft('');
      loadList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mMessaging.loadError'));
    } finally {
      setBusy(false);
    }
  };

  const manage = async (path: 'assign' | 'status', body: { membershipId: 'me' } | { status: 'CLOSED' }) => {
    if (!studioId || !selected) return;
    setError(undefined);
    try {
      await apiRequest(`/studios/${studioId}/inbox/conversations/${selected.id}/${path}`, { method: 'PATCH', body, studioId });
      if (path === 'status') setSelected(null);
      else await open(selected.id);
      loadList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mMessaging.loadError'));
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadList();
    setRefreshing(false);
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: radii.md };

  const list = (
    <View style={styles.pane}>
      {!items && !error ? <ActivityIndicator style={styles.spinner} /> : null}
      {items && items.length === 0 ? <Text style={[styles.empty, fonts.body, { color: c.textSecondary }]}>{t('mMessaging.inbox.empty')}</Text> : null}
      {items?.map((conv) => (
        <Pressable
          key={conv.id}
          accessibilityRole="button"
          accessibilityLabel={conv.contact.displayName}
          accessibilityState={{ selected: selected?.id === conv.id }}
          onPress={() => open(conv.id)}
          style={[styles.card, card, { borderColor: selected?.id === conv.id ? c.primary : c.border }]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.name, fonts.bodyStrong, { color: c.textPrimary }]} numberOfLines={1}>
              {conv.contact.displayName}
            </Text>
            {conv.unreadCount > 0 ? <Text style={[styles.unread, fonts.bodyStrong, { color: c.primary }]}>{conv.unreadCount}</Text> : null}
          </View>
          <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>
            {t(`messaging.channel.${conv.channel}`)} · {formatDateTime(conv.lastMessageAt, locale)}
          </Text>
          <Text style={[styles.preview, fonts.body, { color: c.textSecondary }]} numberOfLines={2}>
            {conv.lastMessagePreview}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const detail = selected ? (
    <View style={styles.pane}>
      {!isTablet ? (
        <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={styles.back}>
          <Text style={[fonts.bodyStrong, { color: c.primary }]}>{t('mMessaging.inbox.back')}</Text>
        </Pressable>
      ) : null}
      <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{selected.contact.displayName}</Text>
      <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{t(`messaging.channel.${selected.channel}`)}</Text>
      {selected.messages.map((m) => {
        const outgoing = m.direction === 'OUT';
        return (
          <View key={m.id} style={[styles.row, outgoing ? styles.rowEnd : styles.rowStart]}>
            <View style={[styles.bubble, card, { backgroundColor: outgoing ? c.surfaceMuted : c.surface }]}>
              <Text style={[styles.body, fonts.body, { color: c.textPrimary }]}>{m.body}</Text>
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{formatDateTime(m.createdAt, locale)}</Text>
            </View>
          </View>
        );
      })}
      {selected.channel === 'WHATSAPP' && selected.whatsappWindowOpen === false ? (
        <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>{t('mMessaging.inbox.windowClosed')}</Text>
      ) : canReply ? (
        <>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('mMessaging.inbox.reply')}
            placeholderTextColor={c.textMuted}
            accessibilityLabel={t('mMessaging.inbox.reply')}
            multiline
            maxLength={4000}
            style={[styles.input, fonts.body, { borderColor: c.border, color: c.textPrimary, backgroundColor: c.surface, borderRadius: radii.sm }]}
          />
          <PrimaryButton label={t('mMessaging.inbox.send')} onPress={reply} loading={busy} disabled={!draft.trim()} />
        </>
      ) : null}
      {canManage ? (
        <View style={styles.actions}>
          {!selected.assignedMembershipId ? (
            <PrimaryButton label={t('mMessaging.inbox.assignToMe')} variant="secondary" onPress={() => manage('assign', { membershipId: 'me' })} />
          ) : null}
          <PrimaryButton label={t('mMessaging.inbox.close')} variant="secondary" onPress={() => manage('status', { status: 'CLOSED' })} />
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      {isTablet ? (
        <View style={styles.split}>
          <View style={styles.listColumn}>{list}</View>
          <View style={styles.detailColumn}>{detail}</View>
        </View>
      ) : selected ? (
        detail
      ) : (
        list
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  split: { flexDirection: 'row', gap: spacing[4] },
  listColumn: { flex: 1 },
  detailColumn: { flex: 2 },
  pane: { gap: spacing[3] },
  spinner: { marginTop: spacing[6] },
  empty: { fontSize: typography.size.md },
  card: { padding: spacing[3], borderWidth: borderWidth, gap: spacing[1] },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing[2] },
  name: { fontSize: typography.size.md, flexShrink: 1 },
  unread: { fontSize: typography.size.sm },
  preview: { fontSize: typography.size.sm },
  back: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  title: { fontSize: typography.size.lg },
  row: { flexDirection: 'row' },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', padding: spacing[3], borderWidth: borderWidth, gap: spacing[1] },
  body: { fontSize: typography.size.md },
  meta: { fontSize: typography.size.xs },
  input: { minHeight: 88, borderWidth: borderWidth, padding: spacing[3], textAlignVertical: 'top', fontSize: typography.size.md },
  actions: { gap: spacing[2] },
});
