import type { BranchDTO } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { TextField } from '../../../src/components/TextField';
import { apiRequest, ApiError } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { radii, spacing, typography, useThemeColors } from '../../../src/theme';

interface KioskDeviceDTO {
  id: string;
  branchId: string;
  name: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  isPending: boolean;
}

interface CreateKioskDeviceResponse {
  id: string;
  branchId: string;
  name: string;
  pairingCode: string;
  pairingCodeExpiresAt: string;
}

/** Owner/manager screen: pair and manage kiosk tablets (studio.settings.manage). */
export default function KioskModuScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { activeStudioId } = useSession();

  const [branches, setBranches] = useState<BranchDTO[]>([]);
  const [devices, setDevices] = useState<KioskDeviceDTO[]>([]);
  const [name, setName] = useState('Resepsiyon Tablet');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [pairing, setPairing] = useState<CreateKioskDeviceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = async () => {
    if (!activeStudioId) return;
    setIsLoading(true);
    try {
      const [branchList, deviceList] = await Promise.all([
        apiRequest<BranchDTO[]>(`/branches/studio/${activeStudioId}`, { studioId: activeStudioId }),
        apiRequest<KioskDeviceDTO[]>(`/studios/${activeStudioId}/kiosk-devices`, { studioId: activeStudioId }),
      ]);
      setBranches(branchList);
      setDevices(deviceList);
      if (!branchId && branchList[0]) setBranchId(branchList[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Yüklenemedi.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId]);

  const createDevice = async () => {
    if (!activeStudioId || !branchId) return;
    setIsSubmitting(true);
    setError(undefined);
    try {
      const res = await apiRequest<CreateKioskDeviceResponse>(`/studios/${activeStudioId}/kiosk-devices`, {
        method: 'POST',
        studioId: activeStudioId,
        body: { branchId, name },
      });
      setPairing(res);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cihaz oluşturulamadı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const revoke = async (deviceId: string) => {
    if (!activeStudioId) return;
    try {
      await apiRequest(`/studios/${activeStudioId}/kiosk-devices/${deviceId}/revoke`, {
        method: 'POST',
        studioId: activeStudioId,
        body: {},
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'İptal edilemedi.');
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Kiosk modu</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Bir tableti kiosk olarak eşleştirin. Eşleştirme kodu 10 dakika geçerlidir.
      </Text>

      {pairing ? (
        <View style={[styles.pairingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.pairingLabel, { color: colors.textSecondary }]}>Eşleştirme kodu</Text>
          <Text style={[styles.pairingCode, { color: colors.textPrimary }]}>{pairing.pairingCode}</Text>
          <Text style={[styles.pairingHint, { color: colors.textMuted }]}>
            Bu kodu tablette "Kiosk moduna gir" ekranına girin.
          </Text>
        </View>
      ) : (
        <>
          <TextField label="Cihaz adı" value={name} onChangeText={setName} placeholder="Resepsiyon Tablet" />
          <View style={styles.branchRow}>
            {branches.map((b) => (
              <Pressable
                key={b.id}
                accessibilityRole="button"
                accessibilityLabel={b.name}
                onPress={() => setBranchId(b.id)}
                style={[
                  styles.branchChip,
                  { borderColor: colors.border },
                  branchId === b.id && { borderColor: colors.textPrimary },
                ]}
              >
                <Text style={{ color: colors.textPrimary }}>{b.name}</Text>
              </Pressable>
            ))}
          </View>
          <PrimaryButton label="Yeni kiosk oluştur" onPress={() => void createDevice()} loading={isSubmitting} disabled={!branchId} />
        </>
      )}

      <PrimaryButton
        label="Bu cihazı kiosk olarak ayarla"
        onPress={() => router.push('/kiosk-mode')}
        variant="secondary"
      />

      {error ? <Text style={[styles.error, { color: colors.textSecondary }]}>{error}</Text> : null}

      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Eşleştirilmiş cihazlar</Text>
      {isLoading ? (
        <ActivityIndicator color={colors.textPrimary} />
      ) : (
        devices.map((d) => (
          <View key={d.id} style={[styles.deviceRow, { borderColor: colors.border }]}>
            <View>
              <Text style={[styles.deviceName, { color: colors.textPrimary }]}>{d.name}</Text>
              <Text style={[styles.deviceStatus, { color: colors.textMuted }]}>
                {d.revokedAt ? 'İptal edildi' : d.isPending ? 'Eşleştirme bekleniyor' : 'Aktif'}
              </Text>
            </View>
            {!d.revokedAt ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${d.name} iptal et`} onPress={() => void revoke(d.id)}>
                <Text style={{ color: colors.textSecondary }}>İptal et</Text>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, marginBottom: spacing[2] },
  subtitle: { fontSize: typography.size.sm, marginBottom: spacing[6] },
  pairingCard: { borderWidth: 1, borderRadius: radii.lg, padding: spacing[5], marginBottom: spacing[6], alignItems: 'center' },
  pairingLabel: { fontSize: typography.size.sm, marginBottom: spacing[2] },
  pairingCode: { fontSize: 32, fontWeight: typography.weight.bold, letterSpacing: 4, marginBottom: spacing[2] },
  pairingHint: { fontSize: typography.size.sm, textAlign: 'center' },
  branchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[4] },
  branchChip: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing[3], paddingVertical: spacing[2], minHeight: 44, justifyContent: 'center' },
  error: { fontSize: typography.size.sm, marginTop: spacing[3] },
  sectionTitle: { fontSize: typography.size.sm, fontWeight: typography.weight.medium, marginTop: spacing[6], marginBottom: spacing[2] },
  deviceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, borderBottomWidth: 1, paddingVertical: spacing[3] },
  deviceName: { fontSize: typography.size.md, fontWeight: typography.weight.medium },
  deviceStatus: { fontSize: typography.size.sm },
});
