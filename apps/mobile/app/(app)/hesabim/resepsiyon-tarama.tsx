import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { apiRequest, ApiError } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { radii, spacing, typography, useThemeColors } from '../../../src/theme';

interface CheckInCandidate {
  bookingId: string;
  scheduleId: string;
  title: string;
  startTime: string;
}

type ScanOutcome =
  | { resolved: true; bookingId: string; status: string }
  | { resolved: false; member: { memberProfileId: string; membershipId: string }; candidates: CheckInCandidate[] };

/** Reception scans a member's dynamic QR (attendance.manage). */
export default function ResepsiyonTaramaScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { activeStudioId } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [error, setError] = useState<string | undefined>();

  const submit = async (token: string, scheduleId?: string) => {
    if (!activeStudioId) return;
    setIsSubmitting(true);
    setError(undefined);
    try {
      const res = await apiRequest<ScanOutcome>(`/studios/${activeStudioId}/check-in/member-qr`, {
        method: 'POST',
        studioId: activeStudioId,
        body: { token, scheduleId },
      });
      setOutcome(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check-in yapılamadı.');
      setOutcome(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleScanned = ({ data }: { data: string }) => {
    if (hasScanned || isSubmitting) return;
    setHasScanned(true);
    setLastToken(data);
    void submit(data);
  };

  const reset = () => {
    setHasScanned(false);
    setLastToken(null);
    setOutcome(null);
    setError(undefined);
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
        <PrimaryButton label="İzin ver" onPress={() => void requestPermission()} />
      </ScreenContainer>
    );
  }

  if (outcome?.resolved) {
    return (
      <ScreenContainer>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Giriş yapıldı</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Üyenin rezervasyonu check-in olarak işaretlendi.</Text>
        <PrimaryButton label="Yeni tarama" onPress={reset} />
      </ScreenContainer>
    );
  }

  if (outcome && !outcome.resolved) {
    return (
      <ScreenContainer>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Bugünkü rezervasyonlar</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Üyenin birden fazla uygun rezervasyonu var, birini seçin.</Text>
        {outcome.candidates.map((c) => (
          <Pressable
            key={c.bookingId}
            accessibilityRole="button"
            accessibilityLabel={c.title}
            style={[styles.candidateRow, { borderColor: colors.border }]}
            onPress={() => lastToken && void submit(lastToken, c.scheduleId)}
          >
            <Text style={[styles.candidateTitle, { color: colors.textPrimary }]}>{c.title}</Text>
            <Text style={[styles.candidateTime, { color: colors.textMuted }]}>
              {new Date(c.startTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Pressable>
        ))}
        <PrimaryButton label="Yeni tarama" onPress={reset} variant="secondary" />
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
        Üyenin uygulamasındaki QR kodunu kareye hizalayın.
      </Text>
      {isSubmitting ? <ActivityIndicator color={colors.textPrimary} style={{ marginTop: spacing[3] }} /> : null}
      {error ? (
        <>
          <Text style={[styles.error, { color: colors.textSecondary }]}>{error}</Text>
          <PrimaryButton label="Yeni tarama" onPress={reset} variant="secondary" />
        </>
      ) : null}
      <PrimaryButton label="Vazgeç" onPress={() => router.back()} variant="secondary" />
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
    marginBottom: spacing[3],
  },
  candidateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderRadius: radii.md,
    marginBottom: spacing[2],
  },
  candidateTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  candidateTime: {
    fontSize: typography.size.sm,
  },
});
