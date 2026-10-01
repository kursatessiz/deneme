'use client';

import { useState } from 'react';
import { SessionDeliveryMode, VideoMeetingProviderKind } from '@platform/shared';
import type { CreateScheduleInput } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { validateScheduleForm, type ScheduleFormValues } from '@/lib/calendar/schedule-form';
import type { BranchRow, ResourceRow, ServiceTypeRow, TrainerRow } from '@/lib/calendar/types';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { FieldGroup } from '@/components/ui/FieldGroup';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <FieldGroup label={label}>{children}</FieldGroup>;
}

export interface SessionFormProps {
  studioId: string;
  branches: BranchRow[];
  resources: ResourceRow[];
  trainers: TrainerRow[];
  serviceTypes: ServiceTypeRow[];
  defaultDate?: string;
  onCancel: () => void;
  onSubmit: (payload: CreateScheduleInput) => Promise<void>;
}

/** Create-session form (W2.2). Fields map 1:1 to CreateScheduleSchema so validation reuses the shared schema. */
export function SessionForm({ studioId, branches, resources, trainers, serviceTypes, defaultDate, onCancel, onSubmit }: SessionFormProps) {
  const t = useT();
  const [values, setValues] = useState<ScheduleFormValues>({
    studioId,
    branchId: '',
    serviceTypeId: serviceTypes[0]?.id ?? '',
    resourceId: '',
    trainerId: '',
    title: '',
    date: defaultDate ?? new Date().toISOString().slice(0, 10),
    startTime: '09:00',
    endTime: '10:00',
    capacity: '',
    isRecurring: false,
    recurringWeeks: '',
    deliveryMode: SessionDeliveryMode.IN_PERSON,
    meetingProvider: '',
    manualMeetingUrl: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateScheduleForm(values, t('common.invalidForm'));
    if (!result.success) {
      setError(result.message);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(result.data);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <Field label={t('calendar.form.title')}>
        <Input value={values.title} onChange={(e) => set('title', e.target.value)} required />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('calendar.form.serviceType')}>
          <Select value={values.serviceTypeId} onChange={(e) => set('serviceTypeId', e.target.value)} required>
            <option value="">{t('calendar.form.choose')}</option>
            {serviceTypes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('calendar.form.branch')}>
          <Select value={values.branchId} onChange={(e) => set('branchId', e.target.value)}>
            <option value="">{t('calendar.form.choose')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('calendar.form.resource')}>
          <Select value={values.resourceId} onChange={(e) => set('resourceId', e.target.value)}>
            <option value="">{t('calendar.form.none')}</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('calendar.form.trainer')}>
          <Select value={values.trainerId} onChange={(e) => set('trainerId', e.target.value)}>
            <option value="">{t('calendar.form.none')}</option>
            {trainers.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.firstName} {tr.lastName}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label={t('calendar.form.date')}>
          <Input type="date" value={values.date} onChange={(e) => set('date', e.target.value)} required />
        </Field>
        <Field label={t('calendar.form.startTime')}>
          <Input type="time" value={values.startTime} onChange={(e) => set('startTime', e.target.value)} required />
        </Field>
        <Field label={t('calendar.form.endTime')}>
          <Input type="time" value={values.endTime} onChange={(e) => set('endTime', e.target.value)} required />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('calendar.form.capacity')}>
          <Input type="number" min={1} value={values.capacity} onChange={(e) => set('capacity', e.target.value)} />
        </Field>
        <Field label={t('calendar.form.deliveryMode')}>
          <Select value={values.deliveryMode} onChange={(e) => set('deliveryMode', e.target.value as SessionDeliveryMode)}>
            <option value={SessionDeliveryMode.IN_PERSON}>{t('calendar.form.deliveryMode.IN_PERSON')}</option>
            <option value={SessionDeliveryMode.ONLINE}>{t('calendar.form.deliveryMode.ONLINE')}</option>
            <option value={SessionDeliveryMode.HYBRID}>{t('calendar.form.deliveryMode.HYBRID')}</option>
          </Select>
        </Field>
      </div>

      {values.deliveryMode !== SessionDeliveryMode.IN_PERSON && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('calendar.form.meetingProvider')}>
            <Select value={values.meetingProvider} onChange={(e) => set('meetingProvider', e.target.value)}>
              <option value="">{t('calendar.form.choose')}</option>
              <option value={VideoMeetingProviderKind.JITSI}>{t('calendar.form.meetingProvider.JITSI')}</option>
              <option value={VideoMeetingProviderKind.MANUAL}>{t('calendar.form.meetingProvider.MANUAL')}</option>
            </Select>
          </Field>
          {values.meetingProvider === VideoMeetingProviderKind.MANUAL && (
            <Field label={t('calendar.form.meetingUrl')}>
              <Input value={values.manualMeetingUrl} onChange={(e) => set('manualMeetingUrl', e.target.value)} placeholder="https://..." />
            </Field>
          )}
        </div>
      )}

      <Checkbox label={t('calendar.form.recurring')} checked={values.isRecurring} onChange={(e) => set('isRecurring', e.target.checked)} />
      {values.isRecurring && (
        <Field label={t('calendar.form.recurringWeeks')}>
          <Input type="number" min={1} max={12} className="w-24" value={values.recurringWeeks} onChange={(e) => set('recurringWeeks', e.target.value)} />
        </Field>
      )}

      {error && <p className="ui-caption ui-text-error">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" tone="surface" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t('calendar.form.creating') : t('calendar.form.create')}
        </Button>
      </div>
    </form>
  );
}
