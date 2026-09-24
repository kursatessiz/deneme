import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { CreateInviteSchema, InviteChannel } from '@platform/shared';

import { PermissionGate } from '../../../../src/components/PermissionGate';
import { PrimaryButton } from '../../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { TextField } from '../../../../src/components/TextField';
import { ApiError, apiRequest } from '../../../../src/lib/api';
import { fieldErrorsFromZod } from '../../../../src/lib/formErrors';
import { useSession } from '../../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors } from '../../../../src/theme';

interface InviteResponse {
  id: string;
  inviteUrl: string;
  token: string;
  expiresAt: string;
  channel: InviteChannel;
}

function YeniUyeContent() {
  const colors = useThemeColors();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invite, setInvite] = useState<InviteResponse | null>(null);

  const handleSubmit = async () => {
    if (!studioId) return;
    setError(undefined);
    setFieldErrors({});
    const parsed = CreateInviteSchema.safeParse({
      studioId,
      fullName,
      phone,
      roleKey: 'member',
      channel: InviteChannel.SHOWN,
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await apiRequest<InviteResponse>('/invites', { method: 'POST', studioId, body: parsed.data });
      setInvite(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Davet oluşturulamadı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (invite) {
    return (
      <ScreenContainer>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Davet oluşturuldu</Text>
        <Text style={[styles.lead, { color: colors.textSecondary }]}>
          Üyeye bu QR kodu gösterin, telefonuyla okutup katılabilir. Bağlantı 72 saat geçerlidir.
        </Text>
        <View style={[styles.qrWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <QRCode value={invite.inviteUrl} size={220} />
        </View>
        <Text style={[styles.url, { color: colors.textMuted }]} selectable>
          {invite.inviteUrl}
        </Text>
        <PrimaryButton label="Yeni bir davet oluştur" onPress={() => setInvite(null)} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Yeni üye davet et</Text>
      <TextField label="Ad soyad" value={fullName} onChangeText={setFullName} errorMessage={fieldErrors.fullName} />
      <TextField
        label="Telefon"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="0532 111 22 33"
        errorMessage={fieldErrors.phone}
      />
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
      <PrimaryButton label="Davet oluştur" onPress={handleSubmit} loading={isSubmitting} />
    </ScreenContainer>
  );
}

/** Staff onboarding: name + phone -> InviteToken -> QR shown on screen (CLAUDE.md onboarding flow). */
export default function YeniUyeScreen() {
  return (
    <PermissionGate anyOf={['members.manage']}>
      <YeniUyeContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, marginBottom: spacing[3] },
  lead: { fontSize: typography.size.sm, marginBottom: spacing[4] },
  qrWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
    borderWidth: 1,
    borderRadius: radii.md,
    marginBottom: spacing[4],
  },
  url: { fontSize: typography.size.xs, textAlign: 'center', marginBottom: spacing[6] },
  error: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
