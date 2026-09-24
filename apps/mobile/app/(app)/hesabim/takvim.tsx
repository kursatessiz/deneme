import type { CalendarFeedCreatedDTO } from '@platform/shared';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';

/**
 * "Takvim aboneliği": creates the personal ICS feed (GET /calendar/:token.ics)
 * so the member can subscribe from their phone or laptop's calendar app.
 * The URL is shown only once per rotation; it is not fetched back later.
 */
export default function TakvimScreen() {
  const colors = useThemeColors();
  const [feed, setFeed] = useState<CalendarFeedCreatedDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const createOrRotateFeed = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    setCopied(false);
    try {
      const result = await apiRequest<CalendarFeedCreatedDTO>('/me/calendar-feed', { method: 'POST' });
      setFeed(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Takvim aboneliği oluşturulamadı.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const revokeFeed = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      await apiRequest<void>('/me/calendar-feed', { method: 'DELETE' });
      setFeed(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Abonelik iptal edilemedi.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const copyUrl = useCallback(async () => {
    if (!feed) return;
    await Clipboard.setStringAsync(feed.url);
    setCopied(true);
  }, [feed]);

  const openInCalendarApp = useCallback(async () => {
    if (!feed) return;
    await Linking.openURL(feed.webcalUrl);
  }, [feed]);

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Takvim aboneliği</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        Rezervasyonlarınızı telefonunuzun veya bilgisayarınızın takvim uygulamasına abone olarak otomatik senkronize
        edebilirsiniz. Bağlantı yalnızca oluşturulduğunda gösterilir; kaybederseniz yeniden oluşturabilirsiniz.
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {isLoading ? <ActivityIndicator color={colors.textPrimary} /> : null}

      {feed ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.urlLabel, { color: colors.textSecondary }]}>Abonelik bağlantısı</Text>
          <Text style={[styles.url, { color: colors.textPrimary }]} selectable>
            {feed.url}
          </Text>

          <PrimaryButton label={copied ? 'Kopyalandı' : 'Bağlantıyı kopyala'} onPress={copyUrl} />
          <PrimaryButton label="Takvim uygulamasında aç" onPress={openInCalendarApp} variant="secondary" />
          <PrimaryButton label="Aboneliği iptal et" onPress={revokeFeed} variant="danger" />
        </View>
      ) : (
        <PrimaryButton label="Takvim aboneliği oluştur" onPress={createOrRotateFeed} loading={isLoading} />
      )}

      {feed ? (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Yeniden oluşturmak (döndürmek) önceki bağlantıyı geçersiz kılar.
        </Text>
      ) : null}
      {feed ? <PrimaryButton label="Bağlantıyı yenile" onPress={createOrRotateFeed} variant="secondary" /> : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginBottom: spacing[2],
  },
  description: {
    fontSize: typography.size.sm,
    marginBottom: spacing[4],
  },
  card: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[4],
    gap: spacing[3],
  },
  urlLabel: {
    fontSize: typography.size.xs,
  },
  url: {
    fontSize: typography.size.sm,
    marginBottom: spacing[2],
  },
  hint: {
    fontSize: typography.size.xs,
    marginBottom: spacing[2],
  },
  errorText: {
    color: palette.danger,
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
});
