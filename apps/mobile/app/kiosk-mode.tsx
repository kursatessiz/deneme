import { CameraView, useCameraPermissions } from 'expo-camera';
import { PhoneSchema } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../src/components/PrimaryButton';
import { TextField } from '../src/components/TextField';
import { useT } from '../src/i18n';
import { ApiError } from '../src/lib/api';
import { kioskRequest } from '../src/lib/kioskApi';
import { clearKioskSession, getKioskSession, setKioskSession } from '../src/lib/kioskStore';
import type { KioskSession } from '../src/lib/kioskStore';
import { useSession } from '../src/lib/session';
import { SCRIM, TOUCH_TARGET, borderWidth, radii, spacing, typography, useThemeColors } from '../src/theme';
import { withAlpha } from '../src/components/tones';
import { Text } from '../src/components/Text';

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
  const t = useT();
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
      if (!response.ok) throw new ApiError(response.status, body.message ?? t('mKiosk.pairFailed'));
      await setKioskSession(body);
      setSession(body);
    } catch (err) {
      setPairError(err instanceof ApiError ? err.message : t('mKiosk.pairFailed'));
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
      setScanError(err instanceof ApiError ? err.message : t('mKiosk.checkInFailed'));
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
      if (!parsedPhone.success) throw new Error(t('mKiosk.invalidPhone'));
      await pinLogin(parsedPhone.data, exitPin);
      await clearKioskSession();
      router.replace('/(app)');
    } catch (err) {
      setExitError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('mKiosk.exitFailed'));
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
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t('mKiosk.title')}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('mKiosk.pairingHint')}</Text>
          <TextField label={t('mKiosk.pairingCodeLabel')} value={pairingCode} onChangeText={(v) => setPairingCode(v.toUpperCase())} placeholder="AB12CD34" />
          {pairError ? <Text style={[styles.error, { color: colors.textSecondary }]}>{pairError}</Text> : null}
          <PrimaryButton label={t('mKiosk.pair')} onPress={() => void pair()} loading={isPairing} disabled={pairingCode.length < 8} />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission?.granted) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t('mKiosk.cameraPermissionRequired')}</Text>
        <PrimaryButton label={t('mKiosk.grantPermission')} onPress={() => void requestPermission()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.headerBand, { backgroundColor: colors.primary }]}>
        <Text style={[styles.headerTitle, { color: colors.onPrimary }]}>{session.deviceName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('mKiosk.a11y.exitKiosk')} style={[styles.exitButton, { backgroundColor: withAlpha(colors.onPrimary, 0.2) }]} onPress={() => setExitVisible(true)}>
          <Text style={[styles.exitButtonLabel, { color: colors.onPrimary }]}>{t('mKiosk.exit')}</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {lastOutcome ? (
          <View style={styles.center}>
            <Text style={[styles.resultTitle, { color: colors.textPrimary }]}>
              {lastOutcome.resolved ? t('mKiosk.checkedIn') : t('mKiosk.selectBooking')}
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
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('mKiosk.showMemberQr')}</Text>
      </View>

      <Modal visible={exitVisible} transparent animationType="fade" onRequestClose={() => setExitVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{t('mKiosk.exitKioskModeTitle')}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('mKiosk.exitSubtitle')}</Text>
            <TextField label={t('mKiosk.phoneLabel')} value={exitPhone} onChangeText={setExitPhone} placeholder={t('common.phonePlaceholder')} keyboardType="phone-pad" />
            <TextField label={t('mKiosk.pinLabel')} value={exitPin} onChangeText={setExitPin} keyboardType="number-pad" maxLength={6} secureTextEntry />
            {exitError ? <Text style={[styles.error, { color: colors.textSecondary }]}>{exitError}</Text> : null}
            <PrimaryButton label={t('mKiosk.signInAndExit')} onPress={() => void handleExit()} loading={isExiting} />
            <PrimaryButton label={t('mKiosk.cancel')} onPress={() => setExitVisible(false)} variant="secondary" />
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
  headerTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  exitButton: { minHeight: TOUCH_TARGET, minWidth: spacing[16] + spacing[6], alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[4], borderRadius: radii.sm },
  exitButtonLabel: { fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  body: { flex: 1, padding: spacing[6], alignItems: 'center', justifyContent: 'center' },
  cameraWrap: { width: '100%', maxWidth: 480, aspectRatio: 1, borderWidth: borderWidth, borderRadius: radii.lg, overflow: 'hidden' },
  hint: { fontSize: typography.size.md, marginTop: spacing[5], textAlign: 'center' },
  resultTitle: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, textAlign: 'center' },
  error: { fontSize: typography.size.sm, textAlign: 'center', marginTop: spacing[3] },
  modalOverlay: { flex: 1, backgroundColor: SCRIM, alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: radii.lg, padding: spacing[6] },
});
