import { CameraView, useCameraPermissions } from 'expo-camera';
import { PhoneSchema } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GradientSurface } from '../src/components/GradientSurface';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { TextField } from '../src/components/TextField';
import { ApiError } from '../src/lib/api';
import { kioskRequest } from '../src/lib/kioskApi';
import { clearKioskSession, getKioskSession, setKioskSession } from '../src/lib/kioskStore';
import type { KioskSession } from '../src/lib/kioskStore';
import { useSession } from '../src/lib/session';
import { radii, spacing, typography, useThemeColors } from '../src/theme';

interface PairResponse {
  token: string;
  studioId: string;
  branchId: string;
  deviceName: string;
}

interface KioskCheckInOutcome {
  resolved: boolean;
  bookingId?: string;
}

/**
 * Full-screen tablet kiosk (W17): device-bound, not tied to a signed-in
 * user. Exiting requires a staff PIN sign-in, same touch pattern as
 * (auth)/pin-login.tsx, so a member cannot leave the kiosk unattended.
 */
export default function KioskModeScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { pinLogin } = useSession();
  const [permission, requestPermission] = useCameraPermissions();

  const [session, setSession] = useState<KioskSession | null | undefined>(undefined);
  const [pairingCode, setPairingCode] = useState('');
  const [pairError, setPairError] = useState<string | undefined>();
  const [isPairing, setIsPairing] = useState(false);

  const [hasScanned, setHasScanned] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scanError, setScanError] = useState<string | undefined>();
  const [lastOutcome, setLastOutcome] = useState<KioskCheckInOutcome | null>(null);

  const [exitVisible, setExitVisible] = useState(false);
  const [exitPhone, setExitPhone] = useState('');
  const [exitPin, setExitPin] = useState('');
  const [exitError, setExitError] = useState<string | undefined>();
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    void getKioskSession().then(setSession);
  }, []);

  const pair = async () => {
    setIsPairing(true);
    setPairError(undefined);
    try {
      const { resolveApiUrl } = await import('../src/lib/api');
      const response = await fetch(`${resolveApiUrl()}/kiosk/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode }),
      });
      const body = (await response.json()) as PairResponse & { message?: string };
      if (!response.ok) throw new ApiError(response.status, body.message ?? 'Eşleştirme başarısız');
      await setKioskSession(body);
      setSession(body);
    } catch (err) {
      setPairError(err instanceof ApiError ? err.message : 'Eşleştirme başarısız');
    } finally {
      setIsPairing(false);
    }
  };

  const handleScanned = async ({ data }: { data: string }) => {
    if (hasScanned || isSubmitting) return;
    setHasScanned(true);
    setIsSubmitting(true);
    setScanError(undefined);
    try {
      const res = await kioskRequest<KioskCheckInOutcome>('/kiosk/check-in', { method: 'POST', body: { token: data } });
      setLastOutcome(res);
    } catch (err) {
      setScanError(err instanceof ApiError ? err.message : 'Check-in yapılamadı.');
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        setHasScanned(false);
        setLastOutcome(null);
      }, 2500);
    }
  };

  const handleExit = async () => {
    setIsExiting(true);
    setExitError(undefined);
    try {
      const parsedPhone = PhoneSchema.safeParse(exitPhone);
      if (!parsedPhone.success) throw new Error('Geçerli bir telefon numarası giriniz');
      await pinLogin(parsedPhone.data, exitPin);
      await clearKioskSession();
      router.replace('/(app)');
    } catch (err) {
      setExitError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Çıkış yapılamadı');
    } finally {
      setIsExiting(false);
    }
  };

  if (session === undefined) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.textPrimary} />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <View style={styles.pairForm}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Kiosk modu</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Yönetici ekranından aldığınız eşleştirme kodunu girin.
          </Text>
          <TextField label="Eşleştirme kodu" value={pairingCode} onChangeText={(v) => setPairingCode(v.toUpperCase())} placeholder="AB12CD34" />
          {pairError ? <Text style={[styles.error, { color: colors.textSecondary }]}>{pairError}</Text> : null}
          <PrimaryButton label="Eşleştir" onPress={() => void pair()} loading={isPairing} disabled={pairingCode.length < 8} />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission?.granted) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Kamera izni gerekli</Text>
        <PrimaryButton label="İzin ver" onPress={() => void requestPermission()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
      <GradientSurface slot="appHeaderBand" style={styles.headerBand}>
        <Text style={styles.headerTitle}>{session.deviceName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Kiosk modundan çık" style={styles.exitButton} onPress={() => setExitVisible(true)}>
          <Text style={styles.exitButtonLabel}>Çıkış</Text>
        </Pressable>
      </GradientSurface>

      <View style={styles.body}>
        {lastOutcome ? (
          <View style={styles.center}>
            <Text style={[styles.resultTitle, { color: colors.textPrimary }]}>
              {lastOutcome.resolved ? 'Giriş yapıldı' : 'Rezervasyon seçin (resepsiyona danışın)'}
            </Text>
          </View>
        ) : (
          <View style={[styles.cameraWrap, { borderColor: colors.border }]}>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={hasScanned ? undefined : handleScanned}
            />
          </View>
        )}
        {isSubmitting ? <ActivityIndicator color={colors.textPrimary} style={{ marginTop: spacing[4] }} /> : null}
        {scanError ? <Text style={[styles.error, { color: colors.textSecondary }]}>{scanError}</Text> : null}
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Üye QR kodunu kameraya gösterin</Text>
      </View>

      <Modal visible={exitVisible} transparent animationType="fade" onRequestClose={() => setExitVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Kiosk modundan çık</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Devam etmek için personel telefon ve PIN'i ile giriş yapın.</Text>
            <TextField label="Telefon numarası" value={exitPhone} onChangeText={setExitPhone} placeholder="05XX XXX XX XX" keyboardType="phone-pad" />
            <TextField label="PIN" value={exitPin} onChangeText={setExitPin} keyboardType="number-pad" maxLength={6} secureTextEntry />
            {exitError ? <Text style={[styles.error, { color: colors.textSecondary }]}>{exitError}</Text> : null}
            <PrimaryButton label="Giriş yap ve çık" onPress={() => void handleExit()} loading={isExiting} />
            <PrimaryButton label="Vazgeç" onPress={() => setExitVisible(false)} variant="secondary" />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  pairForm: { width: '100%', maxWidth: 420, padding: spacing[6] },
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, marginBottom: spacing[2] },
  subtitle: { fontSize: typography.size.sm, marginBottom: spacing[6] },
  headerBand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[5], paddingVertical: spacing[4] },
  headerTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: '#FFFFFF' },
  exitButton: { minHeight: 44, minWidth: 88, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[4], borderRadius: radii.md, backgroundColor: 'rgba(0,0,0,0.25)' },
  exitButtonLabel: { color: '#FFFFFF', fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  body: { flex: 1, padding: spacing[6], alignItems: 'center', justifyContent: 'center' },
  cameraWrap: { width: '100%', maxWidth: 480, aspectRatio: 1, borderWidth: 1, borderRadius: radii.lg, overflow: 'hidden' },
  hint: { fontSize: typography.size.md, marginTop: spacing[5], textAlign: 'center' },
  resultTitle: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, textAlign: 'center' },
  error: { fontSize: typography.size.sm, textAlign: 'center', marginTop: spacing[3] },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: radii.lg, padding: spacing[6] },
});
