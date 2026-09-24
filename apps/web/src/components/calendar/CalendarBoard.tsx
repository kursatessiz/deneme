'use client';

import { useRef, useState } from 'react';
import { addDays, isSameDay, snapToSlot, startOfDay, startOfWeek, weekdayLabel } from '@/lib/calendar/range';
import { trainerName, type ScheduleRow } from '@/lib/calendar/types';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { hasAnyPermission } from '@/lib/nav';

const START_HOUR = 7;
const END_HOUR = 22;
const PX_PER_HOUR = 56;
const GRID_HEIGHT = (END_HOUR - START_HOUR) * PX_PER_HOUR;

function minutesFromDayStart(date: Date): number {
  return (date.getHours() - START_HOUR) * 60 + date.getMinutes();
}

function occupancyTone(bookedCount: number, capacity: number): string {
  if (capacity <= 0) return 'var(--color-surface-muted)';
  const ratio = bookedCount / capacity;
  if (ratio >= 1) return 'rgba(220, 38, 38, 0.16)';
  if (ratio >= 0.7) return 'rgba(217, 119, 6, 0.16)';
  return 'var(--color-surface-muted)';
}

interface Props {
  view: 'day' | 'week';
  anchor: Date;
  schedules: ScheduleRow[];
  selectedId: string | null;
  onSelect: (schedule: ScheduleRow) => void;
  onMove: (schedule: ScheduleRow, newStart: Date, newEnd: Date) => void;
}

/**
 * Day/week time grid with native HTML5 drag-drop to move a session: the
 * dragged block's dataTransfer carries the schedule id and the pointer's
 * grab offset inside the block, so a drop computes the new start from the
 * drop position minus that offset.
 */
export function CalendarBoard({ view, anchor, schedules, selectedId, onSelect, onMove }: Props) {
  const { permissions, isOwner } = useDashboardSession();
  const canDrag = hasAnyPermission(['schedule.manage'], permissions, isOwner);
  const days = view === 'day' ? [startOfDay(anchor)] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  const grabOffsetRef = useRef(0);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  return (
    <div className="flex border" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
      <div className="w-14 shrink-0 border-r" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="h-10 border-b" style={{ borderColor: 'var(--color-border)' }} />
        {hours.map((h) => (
          <div key={h} className="text-[10px] text-right pr-1.5 pt-0.5" style={{ height: PX_PER_HOUR, color: 'var(--color-text-muted)' }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>

      {days.map((day, dayIndex) => {
        const daySchedules = schedules.filter((s) => isSameDay(new Date(s.startTime), day));
        return (
          <div
            key={day.toISOString()}
            className="flex-1 min-w-0 border-r last:border-r-0"
            style={{ borderColor: 'var(--color-border)', backgroundColor: dragOverDay === dayIndex ? 'var(--color-surface-muted)' : 'var(--color-surface)' }}
          >
            <div className="h-10 border-b flex flex-col items-center justify-center" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {weekdayLabel(day)}
              </span>
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {day.getDate()}
              </span>
            </div>
            <div
              className="relative"
              style={{ height: GRID_HEIGHT }}
              onDragOver={(e) => {
                if (!canDrag) return;
                e.preventDefault();
                setDragOverDay(dayIndex);
              }}
              onDragLeave={() => setDragOverDay((d) => (d === dayIndex ? null : d))}
              onDrop={(e) => {
                if (!canDrag) return;
                e.preventDefault();
                setDragOverDay(null);
                const scheduleId = e.dataTransfer.getData('text/schedule-id');
                const schedule = schedules.find((s) => s.id === scheduleId);
                if (!schedule) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const dropOffsetPx = e.clientY - rect.top - grabOffsetRef.current;
                const dropMinutes = Math.max(0, (dropOffsetPx / PX_PER_HOUR) * 60);
                const rawStart = new Date(day);
                rawStart.setHours(START_HOUR, 0, 0, 0);
                rawStart.setMinutes(rawStart.getMinutes() + dropMinutes);
                const newStart = snapToSlot(rawStart, 5);
                const durationMs = new Date(schedule.endTime).getTime() - new Date(schedule.startTime).getTime();
                const newEnd = new Date(newStart.getTime() + durationMs);
                onMove(schedule, newStart, newEnd);
              }}
            >
              {hours.map((h, i) => (
                <div key={h} className="absolute left-0 right-0 border-t" style={{ top: i * PX_PER_HOUR, borderColor: 'var(--color-border)', opacity: 0.5 }} />
              ))}
              {daySchedules.map((s) => {
                const start = new Date(s.startTime);
                const end = new Date(s.endTime);
                const top = Math.max(0, (minutesFromDayStart(start) / 60) * PX_PER_HOUR);
                const height = Math.max(20, ((end.getTime() - start.getTime()) / 60000 / 60) * PX_PER_HOUR);
                const selected = s.id === selectedId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    draggable={canDrag && !s.isCancelled}
                    onDragStart={(e) => {
                      grabOffsetRef.current = e.clientY - e.currentTarget.getBoundingClientRect().top;
                      e.dataTransfer.setData('text/schedule-id', s.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onSelect(s)}
                    className="absolute left-1 right-1 text-left px-1.5 py-1 overflow-hidden"
                    style={{
                      top,
                      height,
                      borderRadius: 'var(--radius-chip)',
                      backgroundColor: occupancyTone(s.bookedCount, s.capacity),
                      border: selected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                      opacity: s.isCancelled ? 0.5 : 1,
                      cursor: canDrag && !s.isCancelled ? 'grab' : 'pointer',
                    }}
                  >
                    <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {s.title || s.serviceType?.name}
                    </p>
                    <p className="text-[10px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
                      {start.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · {s.bookedCount}/{s.capacity}
                      {trainerName(s.trainer) ? ` · ${trainerName(s.trainer)}` : ''}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MonthGrid({ anchor, schedules, onSelectDay }: { anchor: Date; schedules: ScheduleRow[]; onSelectDay: (day: Date) => void }) {
  const gridStart = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekdays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

  return (
    <div className="border" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
      <div className="grid grid-cols-7" style={{ backgroundColor: 'var(--color-surface)' }}>
        {weekdays.map((w) => (
          <div key={w} className="text-[10px] font-medium text-center py-2 border-b" style={{ color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const daySchedules = schedules.filter((s) => isSameDay(new Date(s.startTime), day));
          const inMonth = day.getMonth() === anchor.getMonth();
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDay(day)}
              className="min-h-[92px] text-left p-1.5 border-r border-b last:border-r-0"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', opacity: inMonth ? 1 : 0.45 }}
            >
              <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {day.getDate()}
              </span>
              <div className="mt-1 space-y-0.5">
                {daySchedules.slice(0, 3).map((s) => (
                  <div key={s.id} className="text-[10px] truncate px-1 py-0.5" style={{ borderRadius: 'var(--radius-chip)', backgroundColor: occupancyTone(s.bookedCount, s.capacity) }}>
                    {new Date(s.startTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} {s.title || s.serviceType?.name}
                  </div>
                ))}
                {daySchedules.length > 3 && (
                  <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    +{daySchedules.length - 3} daha
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
