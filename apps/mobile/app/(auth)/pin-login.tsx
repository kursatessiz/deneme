import { PhoneSchema, firstIssueMessage } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';

import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { TextField } from '../../src/components/TextField';
import { useT } from '../../src/i18n';
import { ApiError } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { palette, spacing, typography, useThemeColors } from '../../src/theme';
import { Text } from '../../src/components/Text';

export default function PinLoginScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const t = useT();
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
      setPhoneError(firstIssueMessage(parsedPhone.error, t) ?? t('mAuth.phone.invalid'));
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setPinError(t('mAuth.pin.invalid'));
      return;
    }

    setIsSubmitting(true);
    try {
      await pinLogin(parsedPhone.data, pin);
      router.replace('/(app)');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : t('common.error.generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t('mAuth.pinLogin.title')}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('mAuth.pinLogin.subtitle')}</Text>

      <TextField
        label={t('mAuth.phone.label')}
        value={phone}
        onChangeText={setPhone}
        placeholder={t('mAuth.phone.placeholder')}
        keyboardType="phone-pad"
        errorMessage={phoneError}
      />

      <TextField
        label={t('mAuth.pin.label')}
        value={pin}
        onChangeText={setPin}
        placeholder="••••••"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        errorMessage={pinError}
      />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <PrimaryButton label={t('mAuth.pinLogin.submit')} onPress={handleSubmit} loading={isSubmitting} />
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
  formError: {
    color: palette.danger,
    marginBottom: spacing[3],
    fontSize: typography.size.sm,
  },
});
