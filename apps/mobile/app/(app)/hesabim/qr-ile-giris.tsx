import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { apiRequest, ApiError } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { radii, spacing, typography, useThemeColors } from '../../../src/theme';

interface DynamicQrResponse {
  token: string;
  expiresAt: string;
}

/** Refresh well before the server's 60s TTL so the QR is never shown expired. */
const REFRESH_MS = 45_000;

/** Member self-service: a dynamic QR for reception/kiosk to scan, and a
 * shortcut to scan the studio's own static QR poster instead. */
export default function QrIleGirisScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { activeStudioId } = useSession();

  const [payload, setPayload] = useState<DynamicQrResponse | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  const fetchQr = useCallback(async () => {
    if (!activeStudioId) return;
    try {
      const res = await apiRequest<DynamicQrResponse>('/me/check-in/qr', {
        method: 'POST',
        body: { studioId: activeStudioId },
      });
      setPayload(res);
      setError(undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'QR kodu alınamadı.');
    } finally {
      setIsLoading(false);
    }
  }, [activeStudioId]);

  useEffect(() => {
    void fetchQr();
    const interval = setInterval(() => void fetchQr(), REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchQr]);

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>QR ile giriş</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Bu kodu resepsiyona veya kiosk cihazına okutun. Kod kendiliğinden yenilenir.
      </Text>

      <View style={[styles.qrCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {isLoading ? (
          <ActivityIndicator color={colors.textPrimary} />
        ) : payload ? (
          <QRCode value={payload.token} size={220} backgroundColor={colors.surface} color={colors.textPrimary} />
        ) : (
          <Text style={[styles.error, { color: colors.textSecondary }]}>{error ?? 'QR kodu alınamadı.'}</Text>
        )}
      </View>

      {error && payload ? <Text style={[styles.error, { color: colors.textSecondary }]}>{error}</Text> : null}

      <PrimaryButton label="Stüdyo QR'ını tara" onPress={() => router.push('/(app)/hesabim/studyo-qr-tara')} variant="secondary" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginBottom: spacing[2],
  },
  subtitle: {
    fontSize: typography.size.sm,
    marginBottom: spacing[6],
  },
  qrCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 260,
    borderWidth: 1,
    borderRadius: radii.lg,
    marginBottom: spacing[6],
    padding: spacing[6],
  },
  error: {
    fontSize: typography.size.sm,
    textAlign: 'center',
    marginBottom: spacing[4],
  },
});
