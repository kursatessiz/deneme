import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from './PrimaryButton';
import { palette, radii, spacing, typography, useThemeColors } from '../theme';

interface DateTimeFieldProps {
  label: string;
  /** ISO 8601 string, or '' when nothing is picked yet. */
  value: string;
  onChange: (isoValue: string) => void;
  errorMessage?: string;
}

/**
 * Labeled date + time picker backed by the native picker
 * (`@react-native-community/datetimepicker`, the version Expo SDK 57
 * bundles). Replaces a raw ISO text field: the date button opens the date
 * picker, the time button opens the time picker, and both write back a
 * single ISO string built from the day of one and the time of the other.
 *
 * Android shows its own dialog and reports the choice through `onChange`
 * with `event.type`; iOS has no built-in dialog chrome, so a small modal
 * wraps the inline spinner with a "Tamam" confirm button there.
 */
export function DateTimeField({ label, value, onChange, errorMessage }: DateTimeFieldProps) {
  const colors = useThemeColors();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const [draft, setDraft] = useState<Date | null>(null);

  const current = value ? new Date(value) : null;

  const open = (nextMode: 'date' | 'time') => {
    setDraft(current ?? new Date());
    setMode(nextMode);
  };

  const applyPicked = (picked: Date) => {
    const base = current ?? new Date();
    const next = new Date(base);
    if (mode === 'date') {
      next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    } else if (mode === 'time') {
      next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    }
    onChange(next.toISOString());
  };

  const handleAndroidChange = (event: DateTimePickerEvent, picked?: Date) => {
    const wasSet = event.type === 'set';
    setMode(null);
    if (wasSet && picked) applyPicked(picked);
  };

  const handleIosDraftChange = (_event: DateTimePickerEvent, picked?: Date) => {
    if (picked) setDraft(picked);
  };

  const confirmIos = () => {
    if (draft) applyPicked(draft);
    setMode(null);
  };

  const cancelIos = () => setMode(null);

  const dateLabel = current
    ? current.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Tarih seç';
  const timeLabel = current ? current.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : 'Saat seç';

  const buttonStyle = [
    styles.button,
    { borderColor: errorMessage ? palette.danger : colors.border, backgroundColor: colors.surface },
  ];

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} - tarih`} onPress={() => open('date')} style={buttonStyle}>
          <Text style={{ color: colors.textPrimary }}>{dateLabel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} - saat`} onPress={() => open('time')} style={buttonStyle}>
          <Text style={{ color: colors.textPrimary }}>{timeLabel}</Text>
        </Pressable>
      </View>
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      {mode && Platform.OS === 'android' && (
        <DateTimePicker value={current ?? new Date()} mode={mode} is24Hour onChange={handleAndroidChange} />
      )}

      {mode && Platform.OS !== 'android' && (
        <Modal transparent animationType="fade" visible onRequestClose={cancelIos}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
              <DateTimePicker
                value={draft ?? current ?? new Date()}
                mode={mode}
                is24Hour
                display="spinner"
                onChange={handleIosDraftChange}
              />
              <View style={styles.modalActions}>
                <PrimaryButton label="Vazgeç" onPress={cancelIos} variant="secondary" />
                <PrimaryButton label="Tamam" onPress={confirmIos} />
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing[4] },
  label: { fontSize: typography.size.sm, fontWeight: typography.weight.medium, marginBottom: spacing[1] },
  row: { flexDirection: 'row', gap: spacing[2] },
  button: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    justifyContent: 'center',
  },
  error: { marginTop: spacing[1], color: palette.danger, fontSize: typography.size.xs },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { padding: spacing[4], borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  modalActions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] },
});
