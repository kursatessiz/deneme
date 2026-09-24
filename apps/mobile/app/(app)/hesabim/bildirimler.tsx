import type { NotificationCategory, NotificationPreferenceItemDTO, NotificationPreferencesDTO } from '@platform/shared';
import * as Linking from 'expo-linking';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { SwitchRow } from '../../../src/components/SwitchRow';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { getNotificationPermissionStatus } from '../../../src/lib/push';
import { palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';

type Channel = 'push' | 'sms';

export default function BildirimlerScreen() {
  const colors = useThemeColors();

  const [items, setItems] = useState<NotificationPreferenceItemDTO[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();
  const [permissionDenied, setPermissionDenied] = useState(false);

  const loadPreferences = useCallback(async () => {
    setIsLoading(true);
    setLoadError(undefined);
    try {
      const data = await apiRequest<NotificationPreferencesDTO>('/me/notification-preferences');
      setItems(data.items);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Bildirim ayarları yüklenemedi.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
    (async () => {
      const status = await getNotificationPermissionStatus();
      setPermissionDenied(status === 'denied');
    })();
  }, [loadPreferences]);

  const handleToggle = async (category: NotificationCategory, channel: Channel, nextValue: boolean) => {
    if (!items) return;
    setSaveError(undefined);

    const previousItems = items;
    const updatedItems = items.map((item) => (item.category === category ? { ...item, [channel]: nextValue } : item));
    setItems(updatedItems);

    const target = updatedItems.find((item) => item.category === category);
    if (!target) return;

    try {
      await apiRequest<NotificationPreferencesDTO>('/me/notification-preferences', {
        method: 'PUT',
        body: { preferences: { [category]: { push: target.push, sms: target.sms } } },
      });
    } catch (error) {
      setItems(previousItems);
      setSaveError(error instanceof ApiError ? error.message : 'Değişiklik kaydedilemedi, tekrar deneyin.');
    }
  };

  return (
    <ScreenContainer>
      {permissionDenied ? (
        <View style={[styles.banner, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Text style={[styles.bannerText, { color: colors.textPrimary }]}>
            Push bildirimlerine izin verilmemiş. Bildirim alabilmek için sistem ayarlarından izin verin.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sistem ayarlarını aç"
            onPress={() => Linking.openSettings()}
            style={styles.bannerButton}
          >
            <Text style={styles.bannerButtonText}>Ayarları aç</Text>
          </Pressable>
        </View>
      ) : null}

      {isLoading ? <ActivityIndicator color={colors.textPrimary} /> : null}

      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

      {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

      {items?.map((item) => (
        <View key={item.category} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{item.label}</Text>
          <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>{item.description}</Text>
          {item.marketing ? (
            <Text style={[styles.marketingNote, { color: colors.textMuted }]}>
              Bu bildirimler açık rızanız olmadan gönderilmez ve varsayılan olarak kapalıdır.
            </Text>
          ) : null}

          <View style={styles.switches}>
            <SwitchRow
              label="Push"
              value={item.push}
              onValueChange={(value) => handleToggle(item.category, 'push', value)}
            />
            <SwitchRow label="SMS" value={item.sms} onValueChange={(value) => handleToggle(item.category, 'sms', value)} />
          </View>
        </View>
      ))}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  bannerText: {
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
  bannerButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  bannerButtonText: {
    color: palette.info,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  error: {
    color: palette.danger,
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
  card: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[1],
  },
  cardDescription: {
    fontSize: typography.size.sm,
    marginBottom: spacing[2],
  },
  marketingNote: {
    fontSize: typography.size.xs,
    marginBottom: spacing[2],
  },
  switches: {
    marginTop: spacing[2],
    gap: spacing[2],
  },
});
