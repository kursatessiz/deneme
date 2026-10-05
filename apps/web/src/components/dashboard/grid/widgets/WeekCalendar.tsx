'use client';

import { useMemo } from 'react';
import type { DashboardWidgetPayload } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { useWidgetFormat } from './common';

type Payload = Extract<DashboardWidgetPayload, { kind: 'sessions' }>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Seven day columns from Monday, on the studio's clock (the payload's time
 * zone), so a session always sits under the day it happens at the studio.
 * Each chip shows the start time and title and keeps the details in its
 * title; cancelled sessions are struck through, full ones marked.
 */
export function WeekCalendar({ data }: { data: Payload }) {
  const t = useT();
  const locale = useLocale();
  const f = useWidgetFormat();
  const fmt = useMemo(() => {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: data.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const head = new Intl.DateTimeFormat(locale, { timeZone: data.timeZone, weekday: 'short', day: 'numeric' });
    const time = new Intl.DateTimeFormat(locale, { timeZone: data.timeZone, hour: '2-digit', minute: '2-digit' });
    return { key: (d: Date) => key.format(d), head: (d: Date) => head.format(d), time: (iso: string) => time.format(new Date(iso)) };
  }, [data.timeZone, locale]);

  const start = new Date(data.from).getTime();
  // Noon of each day avoids a daylight saving hour pushing the key into the neighbouring day.
  const days = Array.from({ length: 7 }, (_, i) => new Date(start + i * DAY_MS + DAY_MS / 2));
  const today = fmt.key(new Date());
  const byDay = new Map<string, Payload['sessions']>();
  for (const s of data.sessions) {
    const key = fmt.key(new Date(s.startTime));
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }

  return (
    <div className="ui-week" role="list" aria-label={t('dashboard.widget.weekCalendar.title')}>
      {days.map((d) => {
        const key = fmt.key(d);
        const sessions = byDay.get(key) ?? [];
        return (
          <div key={key} className="ui-week-day" role="listitem" data-today={key === today ? 'true' : 'false'}>
            <div className="ui-week-head ui-small ui-capitalize" title={fmt.head(d)}>
              {fmt.head(d)}
            </div>
            {sessions.length === 0 ? <span className="ui-caption">{t('dashboard.calendar.free')}</span> : null}
            {sessions.map((s) => {
              const tip = `${fmt.time(s.startTime)} ${s.title}${s.trainerName ? `, ${s.trainerName}` : ''} (${f.number(s.booked)}/${f.number(s.capacity)})`;
              return (
                <span key={s.id} className="ui-week-chip" title={tip} data-cancelled={s.isCancelled ? 'true' : 'false'} data-full={!s.isCancelled && s.booked >= s.capacity ? 'true' : 'false'}>
                  <span className="ui-tabular">{fmt.time(s.startTime)}</span> {s.title}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
