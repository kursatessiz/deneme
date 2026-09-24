import { PinSchema } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { TextField } from '../../src/components/TextField';
import { ApiError } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { palette, spacing, typography, useThemeColors } from '../../src/theme';

export default function SetPinScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { setPin } = useSession();

  const [pin, setPinValue] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setPinError(undefined);
    setConfirmError(undefined);
    setFormError(undefined);

    const parsed = PinSchema.safeParse(pin);
    if (!parsed.success) {
      setPinError(parsed.error.issues[0]?.message ?? 'Geçerli bir PIN giriniz');
      return;
    }
    if (pin !== confirmPin) {
      setConfirmError('Girdiğiniz PIN\'ler eşleşmiyor');
      return;
    }

    setIsSubmitting(true);
    try {
      await setPin(parsed.data);
      router.replace('/(app)');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Beklenmeyen bir hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>PIN oluşturun</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Sonraki girişlerinizde kullanmak üzere 6 haneli bir PIN belirleyin.
      </Text>

      <TextField
        label="Yeni PIN"
        value={pin}
        onChangeText={setPinValue}
        placeholder="••••••"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        errorMessage={pinError}
      />

      <TextField
        label="PIN (tekrar)"
        value={confirmPin}
        onChangeText={setConfirmPin}
        placeholder="••••••"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        errorMessage={confirmError}
      />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <PrimaryButton label="PIN'i kaydet" onPress={handleSubmit} loading={isSubmitting} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: typography.size['2xl'],
    fontWeight: typography.weight.bold,
    marginBottom: spacing[2],
  },
  subtitle: {
    fontSize: typography.size.sm,
    marginBottom: spacing[6],
  },
  formError: {
    color: palette.danger,
    marginBottom: spacing[3],
    fontSize: typography.size.sm,
  },
});
