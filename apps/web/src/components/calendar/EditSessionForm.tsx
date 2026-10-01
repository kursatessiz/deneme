'use client';

import { useState } from 'react';
import { UpdateScheduleSchema } from '@platform/shared';
import type { UpdateScheduleInput } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import type { BranchRow, ResourceRow, ScheduleRow, TrainerRow } from '@/lib/calendar/types';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { FieldGroup } from '@/components/ui/FieldGroup';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <FieldGroup label={label}>{children}</FieldGroup>;
}

function toDate(iso: string): string {
  return iso.slice(0, 10);
}
function toTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Edits an existing session against UpdateScheduleSchema (branch, resource, trainer, title, time, capacity). */
export function EditSessionForm({
  schedule,
  branches,
  resources,
  trainers,
  onCancel,
  onSubmit,
}: {
  schedule: ScheduleRow;
  branches: BranchRow[];
  resources: ResourceRow[];
  trainers: TrainerRow[];
  onCancel: () => void;
  onSubmit: (payload: UpdateScheduleInput) => Promise<void>;
}) {
  const t = useT();
  const [title, setTitle] = useState(schedule.title ?? '');
  const [branchId, setBranchId] = useState(schedule.branchId ?? '');
  const [resourceId, setResourceId] = useState(schedule.resourceId ?? '');
  const [trainerId, setTrainerId] = useState(schedule.trainerId ?? '');
  const [date, setDate] = useState(toDate(schedule.startTime));
  const [startTime, setStartTime] = useState(toTime(schedule.startTime));
  const [endTime, setEndTime] = useState(toTime(schedule.endTime));
  const [capacity, setCapacity] = useState(String(schedule.capacity));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      title: title.trim() || undefined,
      branchId: branchId || null,
      resourceId: resourceId || null,
      trainerId: trainerId || null,
      startTime: new Date(`${date}T${startTime}:00`).toISOString(),
      endTime: new Date(`${date}T${endTime}:00`).toISOString(),
      capacity: capacity ? Number(capacity) : undefined,
    };
    const result = UpdateScheduleSchema.safeParse(payload);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? t('common.invalidForm'));
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
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('calendar.form.branch')}>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('calendar.form.branchNone')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('calendar.form.resourceShort')}>
          <Select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
            <option value="">{t('calendar.form.branchNone')}</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t('calendar.form.trainer')}>
        <Select value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
          <option value="">{t('calendar.form.branchNone')}</option>
          {trainers.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.firstName} {tr.lastName}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('calendar.form.date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label={t('calendar.form.startTime')}>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </Field>
        <Field label={t('calendar.form.endTime')}>
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </Field>
      </div>
      <Field label={t('calendar.detail.capacity')}>
        <Input type="number" min={1} className="w-24" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      </Field>

      {error && <p className="ui-caption ui-text-error">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" tone="surface" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t('calendar.form.saving') : t('calendar.form.saveChanges')}
        </Button>
      </div>
    </form>
  );
}
