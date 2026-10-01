import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import type { ContactDetailDTO, ContactDTO, ContactListResponseDTO } from '@platform/shared';

import { PermissionGate } from '../../../src/components/PermissionGate';
import { formatDateTime, useLocale, useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { isTabletWidth } from '../../../src/lib/layout';
import { useSession } from '../../../src/lib/session';
import { borderWidth, palette, radii, spacing, TOUCH_TARGET, typography, useTheme, useThemeFonts } from '../../../src/theme';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';

/**
 * Hesabım > Kişiler (owner and reception, crm.view): a read-only contact
 * list with search and the contact card (stage, tags, commercial consent,
 * recent activity). Editing stays on the web panel. Tablet shows list and
 * card side by side.
 */
export default function KisilerScreen() {
  return (
    <PermissionGate anyOf={['crm.view']}>
      <Contacts />
    </PermissionGate>
  );
}

function Contacts() {
  const t = useT();
  const { locale } = useLocale();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const { width } = useWindowDimensions();
  const isTablet = isTabletWidth(width);
  const studioId = activeMembership?.studioId;

  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ContactDTO[] | null>(null);
  const [selected, setSelected] = useState<ContactDetailDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const loadList = useCallback(
    async (query: string) => {
      if (!studioId) return;
      setError(undefined);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (query.trim()) params.set('search', query.trim());
        const res = await apiRequest<ContactListResponseDTO>(`/crm/studios/${studioId}/contacts?${params.toString()}`, { studioId });
        setItems(res.items);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t('mAccount.contacts.loadError'));
      }
    },
    [studioId, t],
  );

  useEffect(() => {
    const id = setTimeout(() => loadList(search), 300);
    return () => clearTimeout(id);
  }, [loadList, search]);

  const open = async (id: string) => {
    if (!studioId) return;
    setError(undefined);
    try {
      setSelected(await apiRequest<ContactDetailDTO>(`/crm/studios/${studioId}/contacts/${id}`, { studioId }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mAccount.contacts.loadError'));
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadList(search);
    setRefreshing(false);
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: radii.md };

  const list = (
    <View style={styles.pane}>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={t('mAccount.contacts.search')}
        placeholderTextColor={c.textMuted}
        accessibilityLabel={t('mAccount.contacts.search')}
        style={[styles.input, fonts.body, { borderColor: c.border, color: c.textPrimary, backgroundColor: c.surface, borderRadius: radii.sm }]}
      />
      {!items && !error ? <ActivityIndicator style={styles.spinner} /> : null}
      {items && items.length === 0 ? <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>{t('mAccount.contacts.empty')}</Text> : null}
      {items?.map((contact) => (
        <Pressable
          key={contact.id}
          accessibilityRole="button"
          accessibilityLabel={contact.fullName}
          accessibilityState={{ selected: selected?.id === contact.id }}
          onPress={() => open(contact.id)}
          style={[styles.card, card, { borderColor: selected?.id === contact.id ? c.primary : c.border }]}
        >
          <Text style={[styles.name, fonts.bodyStrong, { color: c.textPrimary }]} numberOfLines={1}>
            {contact.fullName}
          </Text>
          <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>
            {[t(`crm.lifecycle.${contact.lifecycleStage}`), contact.phone].filter(Boolean).join(', ')}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const detail = selected ? (
    <View style={styles.pane}>
      {!isTablet ? (
        <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={styles.back}>
          <Text style={[fonts.bodyStrong, { color: c.primary }]}>{t('mAccount.contacts.back')}</Text>
        </Pressable>
      ) : null}
      <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{selected.fullName}</Text>
      <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>
        {[t(`crm.lifecycle.${selected.lifecycleStage}`), selected.phone, selected.email].filter(Boolean).join(', ')}
      </Text>
      {selected.tags.length > 0 ? (
        <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>{`${t('crm.card.tags')}: ${selected.tags.join(', ')}`}</Text>
      ) : null}
      <View style={[styles.card, card]}>
        <Text style={[styles.section, fonts.bodyStrong, { color: c.textPrimary }]}>{t('crm.card.consent')}</Text>
        {selected.consents.map((consent) => (
          <Text key={consent.channel} style={[styles.meta, fonts.body, { color: c.textSecondary }]}>
            {`${t(`messaging.channel.${consent.channel}`)}: ${t(`crm.card.consent.${consent.status}`)}`}
          </Text>
        ))}
      </View>
      <View style={[styles.card, card]}>
        <Text style={[styles.section, fonts.bodyStrong, { color: c.textPrimary }]}>{t('crm.card.timeline')}</Text>
        {selected.activities.length === 0 ? (
          <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{t('crm.card.noActivity')}</Text>
        ) : (
          selected.activities.slice(0, 20).map((a) => (
            <View key={a.id} style={styles.activity}>
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{`${t(`crm.activity.${a.type}`)}, ${formatDateTime(a.createdAt, locale)}`}</Text>
              <Text style={[styles.body, fonts.body, { color: c.textPrimary }]}>{a.body}</Text>
            </View>
          ))
        )}
      </View>
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
  card: { padding: spacing[3], borderWidth: borderWidth, gap: spacing[1] },
  name: { fontSize: typography.size.md },
  back: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  title: { fontSize: typography.size.lg },
  section: { fontSize: typography.size.md },
  activity: { gap: 2, paddingVertical: spacing[1] },
  body: { fontSize: typography.size.md },
  meta: { fontSize: typography.size.sm },
  input: { minHeight: TOUCH_TARGET, borderWidth: borderWidth, paddingHorizontal: spacing[3], fontSize: typography.size.md },
});
