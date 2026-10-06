import { PinSchema, firstIssueMessage } from '@platform/shared';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { TextField } from '../../../src/components/TextField';
import { useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { palette, spacing, typography, useThemeColors } from '../../../src/theme';
import { Text } from '../../../src/components/Text';

export default function ChangePinScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const t = useT();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [successMessage, setSuccessMessage] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setPinError(undefined);
    setConfirmError(undefined);
    setFormError(undefined);
    setSuccessMessage(undefined);

    const parsed = PinSchema.safeParse(pin);
    if (!parsed.success) {
      setPinError(firstIssueMessage(parsed.error, t) ?? t('mAuth.setPin.invalid'));
      return;
    }
    if (pin !== confirmPin) {
      setConfirmError(t('mAuth.setPin.mismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest<void>('/auth/pin', { method: 'PUT', body: { pin: parsed.data } });
      setSuccessMessage(t('mAuth.changePin.success'));
      setPin('');
      setConfirmPin('');
      setTimeout(() => router.back(), 800);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : t('mAuth.changePin.unexpectedError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('mAuth.changePin.subtitle')}</Text>

      <TextField
        label={t('mAuth.setPin.newLabel')}
        value={pin}
        onChangeText={setPin}
        placeholder="••••••"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        errorMessage={pinError}
      />

      <TextField
        label={t('mAuth.setPin.confirmLabel')}
        value={confirmPin}
        onChangeText={setConfirmPin}
        placeholder="••••••"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        errorMessage={confirmError}
      />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}
      {successMessage ? <Text style={[styles.success, { color: palette.success }]}>{successMessage}</Text> : null}

      <PrimaryButton label={t('mAuth.changePin.submit')} onPress={handleSubmit} loading={isSubmitting} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    fontSize: typography.size.sm,
    marginBottom: spacing[6],
  },
  formError: {
    color: palette.danger,
    marginBottom: spacing[3],
    fontSize: typography.size.sm,
  },
  success: {
    marginBottom: spacing[3],
    fontSize: typography.size.sm,
  },
});
