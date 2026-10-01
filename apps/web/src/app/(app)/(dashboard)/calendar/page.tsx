'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CreateScheduleInput, UpdateScheduleInput } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { EmptyState, LoadingState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/common/Modal';
import { CalendarBoard, MonthGrid } from '@/components/calendar/CalendarBoard';
import { SessionForm } from '@/components/calendar/SessionForm';
import { EditSessionForm } from '@/components/calendar/EditSessionForm';
import { SessionDetailPanel } from '@/components/calendar/SessionDetailPanel';
import { rangeForView, stepAnchor, type CalendarView } from '@/lib/calendar/range';
import type { BranchRow, ResourceRow, ScheduleRow, ServiceTypeRow, TrainerRow } from '@/lib/calendar/types';

function CalendarScreen() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const locale = useLocale();
  const router = useRouter();
  const viewLabel: Record<CalendarView, string> = { day: t('calendar.view.day'), week: t('calendar.view.week'), month: t('calendar.view.month') };
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
      .catch((err) => setError(err instanceof BffError ? err.message : t('calendar.errors.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setDragError(err instanceof BffError ? err.message : t('calendar.errors.moveFailed'));
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
    <div className="grid gap-4">
      <PageHeader
        title={t('calendar.title')}
        description={`${start.toLocaleDateString(locale)} - ${new Date(end.getTime() - 1).toLocaleDateString(locale)}`}
        actions={
          <>
            <PermissionButton required={['attendance.manage']} variant="secondary" onClick={() => router.push('/attendance')}>
              {t('calendar.todayAttendance')}
            </PermissionButton>
            <PermissionButton required={['schedule.manage']} variant="primary" onClick={() => setShowCreate(true)}>
              {t('calendar.newSession')}
            </PermissionButton>
          </>
        }
      />

      <div className="pui-card">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="pui-group-row">
            {(['day', 'week', 'month'] as CalendarView[]).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={view === v ? 'solid' : 'outline'}
                tone={view === v ? 'theme' : 'surface'}
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {viewLabel[v]}
              </Button>
            ))}
          </div>
          <div className="pui-group-row">
            <Button size="sm" variant="outline" tone="surface" onClick={() => setAnchor((a) => stepAnchor(view, a, -1))} icon={<ChevronLeft className="ui-icon" aria-hidden="true" />}>
              {t('calendar.nav.previous')}
            </Button>
            <Button size="sm" variant="outline" tone="surface" onClick={() => setAnchor(new Date())}>
              {t('calendar.nav.today')}
            </Button>
            <Button size="sm" variant="outline" tone="surface" onClick={() => setAnchor((a) => stepAnchor(view, a, 1))}>
              {t('calendar.nav.next')}
              <ChevronRight className="ui-icon" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <Filter className="ui-icon ui-text-muted" aria-hidden="true" />
            <Select className="ui-btn-sm" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">{t('calendar.filter.allBranches')}</option>
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Select className="ui-btn-sm" value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)}>
              <option value="">{t('calendar.filter.allResources')}</option>
              {resources?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Select className="ui-btn-sm" value={trainerFilter} onChange={(e) => setTrainerFilter(e.target.value)}>
              <option value="">{t('calendar.filter.allTrainers')}</option>
              {trainers?.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.firstName} {tr.lastName}
                </option>
              ))}
            </Select>
            <Select className="ui-btn-sm" value={serviceTypeFilter} onChange={(e) => setServiceTypeFilter(e.target.value)}>
              <option value="">{t('calendar.filter.allServiceTypes')}</option>
              {serviceTypes?.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {dragError && <ErrorState message={dragError} />}
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {!loading && !error && view === 'week' && schedules.length === 0 && (
        <EmptyState title={t('calendar.empty.title')} description={t('calendar.empty.description')} />
      )}

      {!loading && !error && !(view === 'week' && schedules.length === 0) && (
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
        <Modal title={t('calendar.createTitle')} onClose={() => setShowCreate(false)}>
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
        <Modal title={t('calendar.editTitle')} onClose={() => setShowEdit(false)}>
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
