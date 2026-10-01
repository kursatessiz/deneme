'use client';

import { useRef, useState } from 'react';
import { addDays, isSameDay, shortWeekdayLabels, snapToSlot, startOfDay, startOfWeek, weekdayLabel } from '@/lib/calendar/range';
import { trainerName, type ScheduleRow } from '@/lib/calendar/types';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { hasAnyPermission } from '@/lib/nav';

const START_HOUR = 7;
const END_HOUR = 22;
const PX_PER_HOUR = 56;
const GRID_HEIGHT = (END_HOUR - START_HOUR) * PX_PER_HOUR;

function minutesFromDayStart(date: Date): number {
  return (date.getHours() - START_HOUR) * 60 + date.getMinutes();
}

/** How full a session is; the .ui-cal-chip and .ui-cal-mini classes tint themselves from this (data-load). */
function occupancyLoad(bookedCount: number, capacity: number): 'full' | 'busy' | 'normal' {
  if (capacity <= 0) return 'normal';
  const ratio = bookedCount / capacity;
  if (ratio >= 1) return 'full';
  if (ratio >= 0.7) return 'busy';
  return 'normal';
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
  const locale = useLocale();
  const canDrag = hasAnyPermission(['schedule.manage'], permissions, isOwner);
  const days = view === 'day' ? [startOfDay(anchor)] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  const grabOffsetRef = useRef(0);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  return (
    <div className="ui-cal">
      <div className="ui-cal-gutter">
        <div className="ui-cal-head" />
        {hours.map((h) => (
          <div key={h} className="ui-caption ui-cal-hour" style={{ height: PX_PER_HOUR }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>

      {days.map((day, dayIndex) => {
        const daySchedules = schedules.filter((s) => isSameDay(new Date(s.startTime), day));
        return (
          <div key={day.toISOString()} className="ui-cal-col" data-drop={dragOverDay === dayIndex ? 'true' : undefined}>
            <div className="ui-cal-head flex flex-col items-center justify-center">
              <span className="ui-caption ui-strong">{weekdayLabel(day, locale)}</span>
              <span className="ui-caption ui-strong">{day.getDate()}</span>
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
                <div key={h} className="ui-cal-line" style={{ top: i * PX_PER_HOUR }} />
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
                    className="ui-cal-chip"
                    data-load={occupancyLoad(s.bookedCount, s.capacity)}
                    data-selected={selected ? 'true' : undefined}
                    data-cancelled={s.isCancelled ? 'true' : undefined}
                    style={{ top, height }}
                  >
                    <p className="ui-caption ui-strong truncate">{s.title || s.serviceType?.name}</p>
                    <p className="ui-caption truncate">
                      {start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} · {s.bookedCount}/{s.capacity}
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
  const t = useT();
  const locale = useLocale();
  const gridStart = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekdays = shortWeekdayLabels(locale);

  return (
    <div className="ui-cal-month">
      <div className="ui-cal-weekhead">
        {weekdays.map((w) => (
          <div key={w} className="ui-caption ui-strong text-center py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const daySchedules = schedules.filter((s) => isSameDay(new Date(s.startTime), day));
          const inMonth = day.getMonth() === anchor.getMonth();
          return (
            <button key={day.toISOString()} type="button" onClick={() => onSelectDay(day)} className="ui-cal-cell" data-outside={inMonth ? undefined : 'true'}>
              <span className="ui-caption ui-strong">{day.getDate()}</span>
              <div className="mt-1 space-y-0.5">
                {daySchedules.slice(0, 3).map((s) => (
                  <div key={s.id} className="ui-caption ui-cal-mini" data-load={occupancyLoad(s.bookedCount, s.capacity)}>
                    {new Date(s.startTime).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} {s.title || s.serviceType?.name}
                  </div>
                ))}
                {daySchedules.length > 3 && <div className="ui-caption">{t('calendar.monthGrid.more', { count: daySchedules.length - 3 })}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
