import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { apiRequest, ApiError } from '../../../src/lib/api';
import { radii, spacing, typography, useThemeColors } from '../../../src/theme';

interface ScanResult {
  bookingId: string;
  status: string;
}

/** Member scans the studio's static entrance QR poster (CheckInPoint). */
export default function StudyoQrTaraScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [hasScanned, setHasScanned] = useState(false);

  const handleScanned = async ({ data }: { data: string }) => {
    if (hasScanned || isSubmitting) return;
    setHasScanned(true);
    setIsSubmitting(true);
    setError(undefined);
    // The poster's QR encodes a URL like https://.../c/<token>; the token
    // itself is what the scan endpoint validates.
    const token = data.includes('/c/') ? data.split('/c/').pop() ?? data : data;
    try {
      const res = await apiRequest<ScanResult>('/me/check-in/scan', { method: 'POST', body: { token } });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'QR okunamadı.');
      setHasScanned(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!permission) {
    return (
      <ScreenContainer>
        <ActivityIndicator color={colors.textPrimary} />
      </ScreenContainer>
    );
  }

  if (!permission.granted) {
    return (
      <ScreenContainer>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Kamera izni gerekli</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Stüdyo QR kodunu okutmak için kameraya erişim izni verin.
        </Text>
        <PrimaryButton label="İzin ver" onPress={() => void requestPermission()} />
      </ScreenContainer>
    );
  }

  if (result) {
    return (
      <ScreenContainer>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Giriş yapıldı</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Rezervasyonunuz check-in olarak işaretlendi.</Text>
        <PrimaryButton label="Tamam" onPress={() => router.back()} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll={false}>
      <View style={[styles.cameraWrap, { borderColor: colors.border }]}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={hasScanned ? undefined : handleScanned}
        />
      </View>
      <Text style={[styles.subtitle, { color: colors.textSecondary, marginTop: spacing[4] }]}>
        Stüdyo girişindeki QR kodunu kareye hizalayın.
      </Text>
      {isSubmitting ? <ActivityIndicator color={colors.textPrimary} style={{ marginTop: spacing[3] }} /> : null}
      {error ? <Text style={[styles.error, { color: colors.textSecondary }]}>{error}</Text> : null}
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
  cameraWrap: {
    flex: 1,
    minHeight: 320,
    borderWidth: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  error: {
    fontSize: typography.size.sm,
    textAlign: 'center',
    marginTop: spacing[3],
  },
});
