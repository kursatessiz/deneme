import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { UpdateScheduleSchema } from '@platform/shared';

import { PermissionGate } from '../../../../../src/components/PermissionGate';
import { PrimaryButton } from '../../../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../../../src/components/ScreenContainer';
import { TextField } from '../../../../../src/components/TextField';
import { ApiError, apiRequest } from '../../../../../src/lib/api';
import { fieldErrorsFromZod } from '../../../../../src/lib/formErrors';
import { useSession } from '../../../../../src/lib/session';
import { palette, spacing, typography, useThemeColors } from '../../../../../src/theme';

/**
 * Move/edit an existing session: title, start/end time and capacity, via
 * PATCH /schedules/:scheduleId (schedule.manage; see UpdateScheduleSchema).
 * Trainer/resource/branch reassignment stays on the create form's picker
 * pattern and can be added here the same way when a dedicated edit UX is
 * requested; today edit covers the fields the calendar drag-drop already
 * exercises on web.
 */
function DuzenleContent() {
  const router = useRouter();
  const colors = useThemeColors();
  const { scheduleId, title: initialTitle, startTime: initialStart, endTime: initialEnd, capacity: initialCapacity } =
    useLocalSearchParams<{ scheduleId: string; title?: string; startTime?: string; endTime?: string; capacity?: string }>();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [title, setTitle] = useState(initialTitle ?? '');
  const [startTime, setStartTime] = useState(initialStart ?? '');
  const [endTime, setEndTime] = useState(initialEnd ?? '');
  const [capacity, setCapacity] = useState(initialCapacity ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!studioId) return;
    setError(undefined);
    setFieldErrors({});
    const parsed = UpdateScheduleSchema.safeParse({
      title: title || undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      capacity: capacity ? Number(capacity) : undefined,
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setIsSubmitting(true);
    try {
      await apiRequest(`/schedules/${scheduleId}`, { method: 'PATCH', studioId, body: parsed.data });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Seans güncellenemedi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Seansı düzenle</Text>
      <TextField label="Başlık" value={title} onChangeText={setTitle} errorMessage={fieldErrors.title} />
      <TextField
        label="Başlangıç (ISO)"
        value={startTime}
        onChangeText={setStartTime}
        errorMessage={fieldErrors.startTime}
      />
      <TextField label="Bitiş (ISO)" value={endTime} onChangeText={setEndTime} errorMessage={fieldErrors.endTime} />
      <TextField label="Kontenjan" value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
      <PrimaryButton label="Kaydet" onPress={handleSubmit} loading={isSubmitting} />
    </ScreenContainer>
  );
}

export default function DuzenleScreen() {
  return (
    <PermissionGate anyOf={['schedule.manage']}>
      <DuzenleContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, marginBottom: spacing[3] },
  error: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
