'use client';

import { useState } from 'react';
import { SessionDeliveryMode, VideoMeetingProviderKind } from '@platform/shared';
import type { CreateScheduleInput } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { validateScheduleForm, type ScheduleFormValues } from '@/lib/calendar/schedule-form';
import type { BranchRow, ResourceRow, ServiceTypeRow, TrainerRow } from '@/lib/calendar/types';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
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
    const result = validateScheduleForm(values);
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
    <form onSubmit={handleSubmit} className="space-y-3">
      <Field label={t('calendar.form.title')}>
        <input className="px-2.5 py-1.5 text-sm" style={inputStyle} value={values.title} onChange={(e) => set('title', e.target.value)} required />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('calendar.form.serviceType')}>
          <select className="px-2.5 py-1.5 text-sm" style={inputStyle} value={values.serviceTypeId} onChange={(e) => set('serviceTypeId', e.target.value)} required>
            <option value="">{t('calendar.form.choose')}</option>
            {serviceTypes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('calendar.form.branch')}>
          <select className="px-2.5 py-1.5 text-sm" style={inputStyle} value={values.branchId} onChange={(e) => set('branchId', e.target.value)}>
            <option value="">{t('calendar.form.choose')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('calendar.form.resource')}>
          <select className="px-2.5 py-1.5 text-sm" style={inputStyle} value={values.resourceId} onChange={(e) => set('resourceId', e.target.value)}>
            <option value="">{t('calendar.form.none')}</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('calendar.form.trainer')}>
          <select className="px-2.5 py-1.5 text-sm" style={inputStyle} value={values.trainerId} onChange={(e) => set('trainerId', e.target.value)}>
            <option value="">{t('calendar.form.none')}</option>
            {trainers.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.firstName} {tr.lastName}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label={t('calendar.form.date')}>
          <input type="date" className="px-2.5 py-1.5 text-sm" style={inputStyle} value={values.date} onChange={(e) => set('date', e.target.value)} required />
        </Field>
        <Field label={t('calendar.form.startTime')}>
          <input type="time" className="px-2.5 py-1.5 text-sm" style={inputStyle} value={values.startTime} onChange={(e) => set('startTime', e.target.value)} required />
        </Field>
        <Field label={t('calendar.form.endTime')}>
          <input type="time" className="px-2.5 py-1.5 text-sm" style={inputStyle} value={values.endTime} onChange={(e) => set('endTime', e.target.value)} required />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('calendar.form.capacity')}>
          <input type="number" min={1} className="px-2.5 py-1.5 text-sm" style={inputStyle} value={values.capacity} onChange={(e) => set('capacity', e.target.value)} />
        </Field>
        <Field label={t('calendar.form.deliveryMode')}>
          <select
            className="px-2.5 py-1.5 text-sm"
            style={inputStyle}
            value={values.deliveryMode}
            onChange={(e) => set('deliveryMode', e.target.value as SessionDeliveryMode)}
          >
            <option value={SessionDeliveryMode.IN_PERSON}>{t('calendar.form.deliveryMode.IN_PERSON')}</option>
            <option value={SessionDeliveryMode.ONLINE}>{t('calendar.form.deliveryMode.ONLINE')}</option>
            <option value={SessionDeliveryMode.HYBRID}>{t('calendar.form.deliveryMode.HYBRID')}</option>
          </select>
        </Field>
      </div>

      {values.deliveryMode !== SessionDeliveryMode.IN_PERSON && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('calendar.form.meetingProvider')}>
            <select
              className="px-2.5 py-1.5 text-sm"
              style={inputStyle}
              value={values.meetingProvider}
              onChange={(e) => set('meetingProvider', e.target.value)}
            >
              <option value="">{t('calendar.form.choose')}</option>
              <option value={VideoMeetingProviderKind.JITSI}>{t('calendar.form.meetingProvider.JITSI')}</option>
              <option value={VideoMeetingProviderKind.MANUAL}>{t('calendar.form.meetingProvider.MANUAL')}</option>
            </select>
          </Field>
          {values.meetingProvider === VideoMeetingProviderKind.MANUAL && (
            <Field label={t('calendar.form.meetingUrl')}>
              <input
                className="px-2.5 py-1.5 text-sm"
                style={inputStyle}
                value={values.manualMeetingUrl}
                onChange={(e) => set('manualMeetingUrl', e.target.value)}
                placeholder="https://..."
              />
            </Field>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        <input type="checkbox" checked={values.isRecurring} onChange={(e) => set('isRecurring', e.target.checked)} />
        {t('calendar.form.recurring')}
      </label>
      {values.isRecurring && (
        <Field label={t('calendar.form.recurringWeeks')}>
          <input
            type="number"
            min={1}
            max={12}
            className="px-2.5 py-1.5 text-sm w-24"
            style={inputStyle}
            value={values.recurringWeeks}
            onChange={(e) => set('recurringWeeks', e.target.value)}
          />
        </Field>
      )}

      {error && (
        <p className="text-xs" style={{ color: '#b42318' }}>
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-medium px-3 py-1.5"
          style={{ borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="text-xs font-medium px-4 py-1.5 disabled:opacity-60"
          style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
        >
          {submitting ? t('calendar.form.creating') : t('calendar.form.create')}
        </button>
      </div>
    </form>
  );
}
