import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { VideoContentDTO, VideoContentVisibility } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../../src/theme';

const VISIBILITY_LABELS: Record<VideoContentVisibility, string> = {
  ALL_MEMBERS: 'Tüm üyeler',
  MEMBERS_WITH_ACTIVE_PACKAGE: 'Aktif paketi olan üyeler',
  SPECIFIC_PACKAGES: 'Belirli paketler',
};

const emptyForm = {
  title: '',
  description: '',
  durationMinutes: '10',
  sourceUrl: '',
  visibility: 'ALL_MEMBERS' as VideoContentVisibility,
  creditCost: '',
};

/**
 * Staff screen (content.manage): list, create and publish/unpublish
 * on-demand video content. Uploaded-file provider is not implemented yet -
 * only an external https link (YouTube unlisted, Vimeo, ...) is supported,
 * see docs/VIDEO.md.
 */
export default function VideoIcerikleriScreen() {
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;
  const canManage = activeMembership?.permissions.includes('content.manage') ?? false;

  const [items, setItems] = useState<VideoContentDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [form, setForm] = useState(emptyForm);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studioId) return;
    setLoadError(undefined);
    try {
      const res = await apiRequest<VideoContentDTO[]>(`/video/content/studio/${studioId}`, { studioId });
      setItems(res);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'İçerikler yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canManage) return <Redirect href="/(app)/hesabim" />;

  const handleCreate = async () => {
    if (!studioId) return;
    setSaveError(undefined);
    setIsSaving(true);
    try {
      const durationSeconds = Math.max(1, Math.round(Number(form.durationMinutes || '0') * 60));
      await apiRequest(`/video/content/studio/${studioId}`, {
        method: 'POST',
        studioId,
        body: {
          title: form.title,
          description: form.description || undefined,
          durationSeconds,
          sourceUrl: form.sourceUrl,
          visibility: form.visibility,
          creditCost: form.creditCost ? Number(form.creditCost) : undefined,
        },
      });
      setForm(emptyForm);
      await load();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'İçerik kaydedilemedi.');
    } finally {
      setIsSaving(false);
    }
  };

  const togglePublish = async (item: VideoContentDTO) => {
    if (!studioId) return;
    setBusyId(item.id);
    try {
      await apiRequest(`/video/content/studio/${studioId}/${item.id}/${item.isPublished ? 'unpublish' : 'publish'}`, {
        method: 'POST',
        studioId,
      });
      await load();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'İşlem tamamlanamadı.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: colors.textSecondary }]}>Yeni içerik</Text>
      <TextInput
        placeholder="Başlık"
        placeholderTextColor={colors.textMuted}
        value={form.title}
        onChangeText={(title) => setForm((f) => ({ ...f, title }))}
        style={[styles.input, { borderColor: colors.border, color: colors.textPrimary }]}
      />
      <TextInput
        placeholder="Açıklama"
        placeholderTextColor={colors.textMuted}
        value={form.description}
        onChangeText={(description) => setForm((f) => ({ ...f, description }))}
        style={[styles.input, { borderColor: colors.border, color: colors.textPrimary }]}
      />
      <TextInput
        placeholder="Süre (dakika)"
        placeholderTextColor={colors.textMuted}
        value={form.durationMinutes}
        onChangeText={(durationMinutes) => setForm((f) => ({ ...f, durationMinutes }))}
        keyboardType="number-pad"
        style={[styles.input, { borderColor: colors.border, color: colors.textPrimary }]}
      />
      <TextInput
        placeholder="Video bağlantısı (https://...)"
        placeholderTextColor={colors.textMuted}
        value={form.sourceUrl}
        onChangeText={(sourceUrl) => setForm((f) => ({ ...f, sourceUrl }))}
        autoCapitalize="none"
        style={[styles.input, { borderColor: colors.border, color: colors.textPrimary }]}
      />
      <TextInput
        placeholder="Kredi maliyeti (opsiyonel)"
        placeholderTextColor={colors.textMuted}
        value={form.creditCost}
        onChangeText={(creditCost) => setForm((f) => ({ ...f, creditCost }))}
        keyboardType="number-pad"
        style={[styles.input, { borderColor: colors.border, color: colors.textPrimary }]}
      />
      <View style={styles.visibilityRow}>
        {(Object.keys(VISIBILITY_LABELS) as VideoContentVisibility[]).map((v) => (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityLabel={VISIBILITY_LABELS[v]}
            onPress={() => setForm((f) => ({ ...f, visibility: v }))}
            style={[
              styles.visibilityChip,
              {
                borderColor: form.visibility === v ? colors.primary : colors.border,
                backgroundColor: form.visibility === v ? colors.primary : 'transparent',
              },
            ]}
          >
            <Text style={{ color: form.visibility === v ? colors.surface : colors.textPrimary, fontSize: typography.size.xs }}>
              {VISIBILITY_LABELS[v]}
            </Text>
          </Pressable>
        ))}
      </View>
      {saveError ? <Text style={[styles.message, { color: palette.danger }]}>{saveError}</Text> : null}
      <PrimaryButton label="İçeriği kaydet" onPress={handleCreate} loading={isSaving} disabled={!form.title || !form.sourceUrl} />

      <Text style={[styles.sectionTitle, fonts.bodyStrong, { color: colors.textSecondary, marginTop: spacing[6] }]}>
        Tüm içerikler
      </Text>
      {!items && !loadError ? <ActivityIndicator /> : null}
      {loadError ? <Text style={[styles.message, { color: palette.danger }]}>{loadError}</Text> : null}
      {items?.map((item) => (
        <View key={item.id} style={[styles.itemRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={styles.itemText}>
            <Text style={[styles.itemTitle, fonts.bodyStrong, { color: colors.textPrimary }]}>{item.title}</Text>
            <Text style={[styles.itemSubtitle, fonts.body, { color: colors.textSecondary }]}>
              {VISIBILITY_LABELS[item.visibility]}
              {item.creditCost ? ` · ${item.creditCost} kredi` : ''}
            </Text>
            <Text style={[styles.itemSubtitle, fonts.body, { color: item.isPublished ? palette.success : colors.textMuted }]}>
              {item.isPublished ? 'Yayında' : 'Taslak'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.isPublished ? 'Yayından kaldır' : 'Yayınla'}
            onPress={() => togglePublish(item)}
            disabled={busyId === item.id}
            style={[styles.publishButton, { borderColor: colors.primary }]}
          >
            <Text style={{ color: colors.primary, fontSize: typography.size.xs }}>
              {busyId === item.id ? '...' : item.isPublished ? 'Kaldır' : 'Yayınla'}
            </Text>
          </Pressable>
        </View>
      ))}
      {items?.length === 0 ? (
        <Text style={[styles.message, fonts.body, { color: colors.textSecondary }]}>Henüz video içeriği eklenmedi.</Text>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: typography.size.sm, marginBottom: spacing[2] },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    marginBottom: spacing[2],
    fontSize: typography.size.sm,
  },
  visibilityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[3] },
  visibilityChip: { minHeight: 36, paddingHorizontal: spacing[3], justifyContent: 'center', borderRadius: radii.md, borderWidth: 1 },
  message: { fontSize: typography.size.sm, marginBottom: spacing[2] },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    padding: spacing[3],
    borderWidth: 1,
    borderRadius: radii.md,
    marginBottom: spacing[2],
  },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { fontSize: typography.size.md },
  itemSubtitle: { fontSize: typography.size.xs },
  publishButton: { minHeight: 36, minWidth: 44, paddingHorizontal: spacing[3], justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderRadius: radii.md },
});
