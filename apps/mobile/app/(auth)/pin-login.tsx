import { PhoneSchema } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { TextField } from '../../src/components/TextField';
import { ApiError } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { palette, spacing, typography, useThemeColors } from '../../src/theme';

export default function PinLoginScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { pinLogin } = useSession();

  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [pinError, setPinError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setPhoneError(undefined);
    setPinError(undefined);
    setFormError(undefined);

    const parsedPhone = PhoneSchema.safeParse(phone);
    if (!parsedPhone.success) {
      setPhoneError(parsedPhone.error.issues[0]?.message ?? 'Geçerli bir telefon numarası giriniz');
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setPinError('PIN 6 haneli bir sayı olmalıdır');
      return;
    }

    setIsSubmitting(true);
    try {
      await pinLogin(parsedPhone.data, pin);
      router.replace('/(app)');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Beklenmeyen bir hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>PIN ile giriş</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Telefon numaranız ve PIN'iniz ile giriş yapın.</Text>

      <TextField
        label="Telefon numarası"
        value={phone}
        onChangeText={setPhone}
        placeholder="05XX XXX XX XX"
        keyboardType="phone-pad"
        errorMessage={phoneError}
      />

      <TextField
        label="PIN"
        value={pin}
        onChangeText={setPin}
        placeholder="••••••"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        errorMessage={pinError}
      />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <PrimaryButton label="Giriş yap" onPress={handleSubmit} loading={isSubmitting} />
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
