'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CreateScheduleInput, UpdateScheduleInput } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Modal } from '@/components/common/Modal';
import { CalendarBoard, MonthGrid } from '@/components/calendar/CalendarBoard';
import { SessionForm } from '@/components/calendar/SessionForm';
import { EditSessionForm } from '@/components/calendar/EditSessionForm';
import { SessionDetailPanel } from '@/components/calendar/SessionDetailPanel';
import { rangeForView, stepAnchor, type CalendarView } from '@/lib/calendar/range';
import type { BranchRow, ResourceRow, ScheduleRow, ServiceTypeRow, TrainerRow } from '@/lib/calendar/types';

const VIEW_LABEL: Record<CalendarView, string> = { day: 'Gün', week: 'Hafta', month: 'Ay' };

function CalendarScreen() {
  const { activeStudioId } = useDashboardSession();
  const router = useRouter();
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [branchFilter, setBranchFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [trainerFilter, setTrainerFilter] = useState('');
  const [serviceTypeFilter, setServiceTypeFilter] = useState('');

  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScheduleRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);

  const { start, end } = useMemo(() => rangeForView(view, anchor), [view, anchor]);

  const { data: branches } = useBff<BranchRow[]>(`branches/studio/${activeStudioId}`, activeStudioId);
  const { data: resources } = useBff<ResourceRow[]>(`catalog/resources/studio/${activeStudioId}`, activeStudioId);
  const { data: trainers } = useBff<TrainerRow[]>(`trainers/studio/${activeStudioId}`, activeStudioId);
  const { data: serviceTypes } = useBff<ServiceTypeRow[]>(`catalog/service-types/studio/${activeStudioId}`, activeStudioId);

  const loadSchedules = useCallback(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ startDate: start.toISOString(), endDate: end.toISOString() });
    if (branchFilter) params.set('branchId', branchFilter);
    if (resourceFilter) params.set('resourceId', resourceFilter);
    if (trainerFilter) params.set('trainerId', trainerFilter);
    bffFetch<ScheduleRow[]>(`schedules/studio/${activeStudioId}?${params.toString()}`, { studioId: activeStudioId })
      .then((rows) => setSchedules(serviceTypeFilter ? rows.filter((r) => r.serviceTypeId === serviceTypeFilter) : rows))
      .catch((err) => setError(err instanceof BffError ? err.message : 'Takvim yüklenemedi'))
      .finally(() => setLoading(false));
  }, [activeStudioId, start, end, branchFilter, resourceFilter, trainerFilter, serviceTypeFilter]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    if (!selected) return;
    const fresh = schedules.find((s) => s.id === selected.id);
    setSelected(fresh ?? null);
  }, [schedules, selected?.id]);

  async function handleMove(schedule: ScheduleRow, newStart: Date, newEnd: Date) {
    const previous = schedules;
    // Optimistic UI: move the block immediately, roll back if the API rejects it.
    setSchedules((rows) => rows.map((r) => (r.id === schedule.id ? { ...r, startTime: newStart.toISOString(), endTime: newEnd.toISOString() } : r)));
    setDragError(null);
    try {
      const body: UpdateScheduleInput = { startTime: newStart.toISOString(), endTime: newEnd.toISOString() };
      await bffFetch(`schedules/${schedule.id}`, { method: 'PATCH', studioId: activeStudioId, body });
    } catch (err) {
      setSchedules(previous);
      setDragError(err instanceof BffError ? err.message : 'Seans taşınamadı');
    }
  }

  async function handleCreate(payload: CreateScheduleInput) {
    await bffFetch('schedules', { method: 'POST', studioId: activeStudioId, body: payload });
    setShowCreate(false);
    loadSchedules();
  }

  async function handleEdit(payload: UpdateScheduleInput) {
    if (!selected) return;
    await bffFetch(`schedules/${selected.id}`, { method: 'PATCH', studioId: activeStudioId, body: payload });
    setShowEdit(false);
    loadSchedules();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            Seans Takvimi
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {start.toLocaleDateString('tr-TR')} - {new Date(end.getTime() - 1).toLocaleDateString('tr-TR')}
          </p>
        </div>
        <div className="flex gap-2">
          <PermissionButton required={['attendance.manage']} variant="secondary" onClick={() => router.push('/attendance')}>
            Bugünün yoklaması
          </PermissionButton>
          <PermissionButton required={['schedule.manage']} variant="primary" onClick={() => setShowCreate(true)}>
            Yeni seans
          </PermissionButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex" style={{ borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
          {(['day', 'week', 'month'] as CalendarView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="text-xs font-medium px-3 py-1.5"
              style={{
                backgroundColor: view === v ? 'var(--color-primary)' : 'var(--color-surface)',
                color: view === v ? 'var(--color-on-primary)' : 'var(--color-text-secondary)',
              }}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setAnchor((a) => stepAnchor(view, a, -1))}
          className="text-xs px-2.5 py-1.5"
          style={{ borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          Önceki
        </button>
        <button
          onClick={() => setAnchor(new Date())}
          className="text-xs px-2.5 py-1.5"
          style={{ borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          Bugün
        </button>
        <button
          onClick={() => setAnchor((a) => stepAnchor(view, a, 1))}
          className="text-xs px-2.5 py-1.5"
          style={{ borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          Sonraki
        </button>

        <select
          className="text-xs px-2.5 py-1.5 ml-auto"
          style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
        >
          <option value="">Tüm şubeler</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          className="text-xs px-2.5 py-1.5"
          style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          value={resourceFilter}
          onChange={(e) => setResourceFilter(e.target.value)}
        >
          <option value="">Tüm kaynaklar</option>
          {resources?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          className="text-xs px-2.5 py-1.5"
          style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          value={trainerFilter}
          onChange={(e) => setTrainerFilter(e.target.value)}
        >
          <option value="">Tüm eğitmenler</option>
          {trainers?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.firstName} {t.lastName}
            </option>
          ))}
        </select>
        <select
          className="text-xs px-2.5 py-1.5"
          style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          value={serviceTypeFilter}
          onChange={(e) => setServiceTypeFilter(e.target.value)}
        >
          <option value="">Tüm hizmet türleri</option>
          {serviceTypes?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {dragError && <ErrorState message={dragError} />}
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {!loading && !error && (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex-1 min-w-0">
            {view === 'month' ? (
              <MonthGrid
                anchor={anchor}
                schedules={schedules}
                onSelectDay={(day) => {
                  setAnchor(day);
                  setView('day');
                }}
              />
            ) : (
              <CalendarBoard view={view} anchor={anchor} schedules={schedules} selectedId={selected?.id ?? null} onSelect={setSelected} onMove={handleMove} />
            )}
          </div>

          {selected && (
            <SessionDetailPanel
              studioId={activeStudioId}
              schedule={selected}
              trainers={trainers ?? []}
              onClose={() => setSelected(null)}
              onChanged={loadSchedules}
              onEdit={() => setShowEdit(true)}
            />
          )}
        </div>
      )}

      {showCreate && (
        <Modal title="Yeni seans oluştur" onClose={() => setShowCreate(false)}>
          <SessionForm
            studioId={activeStudioId}
            branches={branches ?? []}
            resources={resources ?? []}
            trainers={trainers ?? []}
            serviceTypes={serviceTypes ?? []}
            defaultDate={anchor.toISOString().slice(0, 10)}
            onCancel={() => setShowCreate(false)}
            onSubmit={handleCreate}
          />
        </Modal>
      )}

      {showEdit && selected && (
        <Modal title="Seansı düzenle" onClose={() => setShowEdit(false)}>
          <EditSessionForm
            schedule={selected}
            branches={branches ?? []}
            resources={resources ?? []}
            trainers={trainers ?? []}
            onCancel={() => setShowEdit(false)}
            onSubmit={handleEdit}
          />
        </Modal>
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <PageGuard required={['schedule.view']}>
      <CalendarScreen />
    </PageGuard>
  );
}
