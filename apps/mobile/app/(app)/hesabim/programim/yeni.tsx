import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CreateScheduleSchema, SessionDeliveryMode, VideoMeetingProviderKind } from '@platform/shared';

import { PermissionGate } from '../../../../src/components/PermissionGate';
import { PrimaryButton } from '../../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { TextField } from '../../../../src/components/TextField';
import { ApiError, apiRequest } from '../../../../src/lib/api';
import { fieldErrorsFromZod } from '../../../../src/lib/formErrors';
import { useSession } from '../../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../../../src/theme';

interface PickOption {
  id: string;
  name: string;
}

function PickerRow({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: PickOption[];
  value: string;
  onSelect: (id: string) => void;
}) {
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  return (
    <View style={styles.pickerBlock}>
      <Text style={[styles.pickerLabel, fonts.body, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((opt) => (
          <Pressable
            key={opt.id}
            accessibilityRole="button"
            accessibilityState={{ selected: value === opt.id }}
            onPress={() => onSelect(value === opt.id ? '' : opt.id)}
            style={[
              styles.chip,
              { borderColor: colors.border, backgroundColor: value === opt.id ? colors.primary : colors.surface },
            ]}
          >
            <Text style={{ color: value === opt.id ? colors.onPrimary : colors.textPrimary, fontSize: typography.size.sm }}>
              {opt.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function YeniSeansContent() {
  const router = useRouter();
  const colors = useThemeColors();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;

  const [serviceTypes, setServiceTypes] = useState<PickOption[]>([]);
  const [resources, setResources] = useState<PickOption[]>([]);
  const [trainers, setTrainers] = useState<PickOption[]>([]);
  const [branches, setBranches] = useState<PickOption[]>([]);

  const [serviceTypeId, setServiceTypeId] = useState('');
  const [trainerId, setTrainerId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [capacity, setCapacity] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<SessionDeliveryMode>(SessionDeliveryMode.IN_PERSON);
  const [meetingUrl, setMeetingUrl] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!studioId) return;
    apiRequest<{ id: string; name: string }[]>(`/catalog/service-types/studio/${studioId}`, { studioId })
      .then((rows) => setServiceTypes(rows.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => setServiceTypes([]));
    apiRequest<{ id: string; name: string }[]>(`/catalog/resources/studio/${studioId}`, { studioId })
      .then((rows) => setResources(rows.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => setResources([]));
    apiRequest<{ id: string; firstName: string; lastName: string }[]>(`/trainers/studio/${studioId}`, { studioId })
      .then((rows) => setTrainers(rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` }))))
      .catch(() => setTrainers([]));
    apiRequest<{ id: string; name: string }[]>(`/branches/studio/${studioId}`, { studioId })
      .then((rows) => setBranches(rows.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => setBranches([]));
  }, [studioId]);

  const handleSubmit = async () => {
    if (!studioId) return;
    setError(undefined);
    setFieldErrors({});
    const parsed = CreateScheduleSchema.safeParse({
      studioId,
      branchId: branchId || undefined,
      serviceTypeId,
      resourceId: resourceId || undefined,
      trainerId: trainerId || undefined,
      title,
      startTime,
      endTime,
      capacity: capacity ? Number(capacity) : undefined,
      deliveryMode,
      meetingProvider: deliveryMode === SessionDeliveryMode.IN_PERSON ? undefined : VideoMeetingProviderKind.MANUAL,
      manualMeetingUrl: deliveryMode === SessionDeliveryMode.IN_PERSON ? undefined : meetingUrl || undefined,
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setIsSubmitting(true);
    try {
      await apiRequest('/schedules', { method: 'POST', studioId, body: parsed.data });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Seans oluşturulamadı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <ScrollView>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Yeni seans</Text>
        <TextField label="Başlık" value={title} onChangeText={setTitle} errorMessage={fieldErrors.title} />
        <PickerRow label="Hizmet türü" options={serviceTypes} value={serviceTypeId} onSelect={setServiceTypeId} />
        <PickerRow label="Eğitmen" options={trainers} value={trainerId} onSelect={setTrainerId} />
        <PickerRow label="Kaynak" options={resources} value={resourceId} onSelect={setResourceId} />
        <PickerRow label="Şube" options={branches} value={branchId} onSelect={setBranchId} />
        <TextField
          label="Başlangıç (YYYY-AA-GGTSS:DD:00.000Z)"
          value={startTime}
          onChangeText={setStartTime}
          placeholder="2026-09-25T09:00:00.000Z"
          errorMessage={fieldErrors.startTime}
        />
        <TextField
          label="Bitiş (YYYY-AA-GGTSS:DD:00.000Z)"
          value={endTime}
          onChangeText={setEndTime}
          placeholder="2026-09-25T10:00:00.000Z"
          errorMessage={fieldErrors.endTime}
        />
        <TextField label="Kontenjan" value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />
        <PickerRow
          label="Teslim şekli"
          options={[
            { id: SessionDeliveryMode.IN_PERSON, name: 'Yüz yüze' },
            { id: SessionDeliveryMode.ONLINE, name: 'Çevrimiçi' },
            { id: SessionDeliveryMode.HYBRID, name: 'Hibrit' },
          ]}
          value={deliveryMode}
          onSelect={(id) => setDeliveryMode(id as SessionDeliveryMode)}
        />
        {deliveryMode !== SessionDeliveryMode.IN_PERSON ? (
          <TextField
            label="Toplantı bağlantısı (https)"
            value={meetingUrl}
            onChangeText={setMeetingUrl}
            placeholder="https://..."
            errorMessage={fieldErrors.manualMeetingUrl}
          />
        ) : null}
        {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
        <PrimaryButton label="Seansı oluştur" onPress={handleSubmit} loading={isSubmitting} />
      </ScrollView>
    </ScreenContainer>
  );
}

/** Staff session creation (schedule.manage): service type, trainer, resource, branch, time, capacity, W19 delivery mode/link. */
export default function YeniSeansScreen() {
  return (
    <PermissionGate anyOf={['schedule.manage']}>
      <YeniSeansContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, marginBottom: spacing[3] },
  pickerBlock: { marginBottom: spacing[4] },
  pickerLabel: { fontSize: typography.size.sm, marginBottom: spacing[1] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: { minHeight: 36, paddingHorizontal: spacing[3], justifyContent: 'center', borderRadius: radii.full, borderWidth: 1 },
  error: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
