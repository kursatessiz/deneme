import { OtpCodeSchema, firstIssueMessage } from '@platform/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { TextField } from '../../src/components/TextField';
import { useT } from '../../src/i18n';
import { ApiError } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { palette, spacing, typography, useThemeColors } from '../../src/theme';
import { Text } from '../../src/components/Text';

const RESEND_COOLDOWN_SECONDS = 60;

export default function OtpScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const t = useT();
  const { phone: phoneParam } = useLocalSearchParams<{ phone: string }>();
  const phone = typeof phoneParam === 'string' ? phoneParam : '';
  const { verifyOtp, requestOtp } = useSession();

  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleVerify = async () => {
    setFieldError(undefined);
    setFormError(undefined);

    const parsed = OtpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setFieldError(firstIssueMessage(parsed.error, t) ?? t('mAuth.otp.invalid'));
      return;
    }

    setIsSubmitting(true);
    try {
      const { hasPin } = await verifyOtp(phone, parsed.data);
      if (hasPin) {
        router.replace('/(app)');
      } else {
        router.replace({ pathname: '/(auth)/set-pin', params: { phone } });
      }
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : t('common.error.generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setFormError(undefined);
    setIsResending(true);
    try {
      await requestOtp(phone);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : t('common.error.generic'));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t('mAuth.otp.title')}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('mAuth.otp.subtitle', { phone })}</Text>

      <TextField
        label={t('mAuth.otp.label')}
        value={code}
        onChangeText={setCode}
        placeholder="123456"
        keyboardType="number-pad"
        maxLength={6}
        errorMessage={fieldError}
      />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <PrimaryButton label={t('mAuth.otp.verify')} onPress={handleVerify} loading={isSubmitting} />

      <View style={styles.spacer} />

      <PrimaryButton
        label={cooldown > 0 ? t('mAuth.otp.resendCooldown', { seconds: cooldown }) : t('mAuth.otp.resend')}
        onPress={handleResend}
        disabled={cooldown > 0}
        loading={isResending}
        variant="secondary"
      />
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
  spacer: {
    height: spacing[3],
  },
});
