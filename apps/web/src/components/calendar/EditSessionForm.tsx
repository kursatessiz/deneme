'use client';

import { useState } from 'react';
import { UpdateScheduleSchema } from '@platform/shared';
import type { UpdateScheduleInput } from '@platform/shared';
import type { BranchRow, ResourceRow, ScheduleRow, TrainerRow } from '@/lib/calendar/types';

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
      setError(result.error.issues[0]?.message ?? 'Form geçersiz');
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
      <Field label="Başlık">
        <input className="px-2.5 py-1.5 text-sm" style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Şube">
          <select className="px-2.5 py-1.5 text-sm" style={inputStyle} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Yok</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kaynak">
          <select className="px-2.5 py-1.5 text-sm" style={inputStyle} value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
            <option value="">Yok</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Eğitmen">
        <select className="px-2.5 py-1.5 text-sm" style={inputStyle} value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
          <option value="">Yok</option>
          {trainers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.firstName} {t.lastName}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Tarih">
          <input type="date" className="px-2.5 py-1.5 text-sm" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Başlangıç">
          <input type="time" className="px-2.5 py-1.5 text-sm" style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </Field>
        <Field label="Bitiş">
          <input type="time" className="px-2.5 py-1.5 text-sm" style={inputStyle} value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </Field>
      </div>
      <Field label="Kapasite">
        <input type="number" min={1} className="px-2.5 py-1.5 text-sm w-24" style={inputStyle} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      </Field>

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
          Vazgeç
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="text-xs font-medium px-4 py-1.5 disabled:opacity-60"
          style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
        >
          {submitting ? 'Kaydediliyor...' : 'Değişiklikleri kaydet'}
        </button>
      </div>
    </form>
  );
}
