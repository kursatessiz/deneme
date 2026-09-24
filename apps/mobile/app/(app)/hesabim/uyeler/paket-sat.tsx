import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PaymentMethod, SellPackageSchema } from '@platform/shared';

import { PermissionGate } from '../../../../src/components/PermissionGate';
import { PrimaryButton } from '../../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { TextField } from '../../../../src/components/TextField';
import { ApiError, apiRequest } from '../../../../src/lib/api';
import { fieldErrorsFromZod } from '../../../../src/lib/formErrors';
import { useSession } from '../../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../../../src/theme';

interface PackageDefinitionRow {
  id: string;
  name: string;
  price: number;
}

const METHOD_LABEL: Partial<Record<PaymentMethod, string>> = {
  [PaymentMethod.CASH]: 'Nakit',
  [PaymentMethod.CREDIT_CARD_POS]: 'Kart (POS)',
  [PaymentMethod.BANK_TRANSFER]: 'Havale',
};

function PaketSatContent() {
  const router = useRouter();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [packages, setPackages] = useState<PackageDefinitionRow[]>([]);
  const [packageDefinitionId, setPackageDefinitionId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [paidAmount, setPaidAmount] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!studioId) return;
    apiRequest<PackageDefinitionRow[]>(`/catalog/package-definitions/studio/${studioId}`, { studioId })
      .then(setPackages)
      .catch(() => setPackages([]));
  }, [studioId]);

  const selected = packages.find((p) => p.id === packageDefinitionId);

  const handleSubmit = async () => {
    if (!studioId) return;
    setError(undefined);
    setFieldErrors({});
    const parsed = SellPackageSchema.safeParse({
      studioId,
      memberId,
      packageDefinitionId,
      paymentMethod,
      paidAmount: paidAmount ? Number(paidAmount) : selected?.price ?? 0,
      currency: 'TRY',
      installmentCount: 1,
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setIsSubmitting(true);
    try {
      await apiRequest('/payments/sell', { method: 'POST', studioId, body: parsed.data });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Paket satılamadı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (done) {
    return (
      <ScreenContainer>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Paket satıldı</Text>
        <PrimaryButton label="Üye kartına dön" onPress={() => router.back()} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Paket sat</Text>
      <Text style={[styles.label, fonts.body, { color: colors.textSecondary }]}>Paket</Text>
      <View style={styles.chipRow}>
        {packages.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityState={{ selected: packageDefinitionId === p.id }}
            onPress={() => {
              setPackageDefinitionId(p.id);
              setPaidAmount(String(p.price));
            }}
            style={[
              styles.chip,
              { borderColor: colors.border, backgroundColor: packageDefinitionId === p.id ? colors.primary : colors.surface },
            ]}
          >
            <Text style={{ color: packageDefinitionId === p.id ? colors.onPrimary : colors.textPrimary }}>{p.name}</Text>
          </Pressable>
        ))}
      </View>
      {fieldErrors.packageDefinitionId ? (
        <Text style={[styles.error, { color: palette.danger }]}>{fieldErrors.packageDefinitionId}</Text>
      ) : null}

      <Text style={[styles.label, fonts.body, { color: colors.textSecondary }]}>Ödeme yöntemi</Text>
      <View style={styles.chipRow}>
        {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="button"
            accessibilityState={{ selected: paymentMethod === m }}
            onPress={() => setPaymentMethod(m)}
            style={[styles.chip, { borderColor: colors.border, backgroundColor: paymentMethod === m ? colors.primary : colors.surface }]}
          >
            <Text style={{ color: paymentMethod === m ? colors.onPrimary : colors.textPrimary }}>
              {METHOD_LABEL[m] ?? m}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextField
        label="Tahsil edilen tutar (TRY)"
        value={paidAmount}
        onChangeText={setPaidAmount}
        keyboardType="decimal-pad"
        errorMessage={fieldErrors.paidAmount}
      />

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
      <PrimaryButton label="Satışı tamamla" onPress={handleSubmit} loading={isSubmitting} />
    </ScreenContainer>
  );
}

/** Reception package sale from the member card, against the existing POST /payments/sell (packages.sell). */
export default function PaketSatScreen() {
  return (
    <PermissionGate anyOf={['packages.sell']}>
      <PaketSatContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, marginBottom: spacing[3] },
  label: { fontSize: typography.size.sm, marginBottom: spacing[1] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[4] },
  chip: { minHeight: 40, paddingHorizontal: spacing[3], justifyContent: 'center', borderRadius: radii.full, borderWidth: 1 },
  error: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
