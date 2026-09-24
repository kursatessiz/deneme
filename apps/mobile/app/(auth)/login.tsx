import { PhoneSchema } from '@platform/shared';
import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { TextField } from '../../src/components/TextField';
import { ApiError } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { palette, spacing, typography, useThemeColors } from '../../src/theme';

export default function LoginScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { requestOtp } = useSession();

  const [phone, setPhone] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleContinue = async () => {
    setFieldError(undefined);
    setFormError(undefined);

    const parsed = PhoneSchema.safeParse(phone);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Geçerli bir telefon numarası giriniz');
      return;
    }

    setIsSubmitting(true);
    try {
      await requestOtp(parsed.data);
      router.push({ pathname: '/(auth)/otp', params: { phone: parsed.data } });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Beklenmeyen bir hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Hoş geldiniz</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Devam etmek için telefon numaranızı girin, size bir doğrulama kodu gönderelim.
      </Text>

      <TextField
        label="Telefon numarası"
        value={phone}
        onChangeText={setPhone}
        placeholder="05XX XXX XX XX"
        keyboardType="phone-pad"
        errorMessage={fieldError}
      />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <PrimaryButton label="Devam et" onPress={handleContinue} loading={isSubmitting} />

      <Link href="/(auth)/pin-login" style={[styles.linkWrap]}>
        <Text style={[styles.link, { color: colors.textSecondary }]}>PIN ile giriş</Text>
      </Link>
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
  linkWrap: {
    marginTop: spacing[5],
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  link: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    textDecorationLine: 'underline',
  },
});
