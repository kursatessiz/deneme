'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { DashboardPeriod } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { formatMoney } from '@/lib/money';
import { cx } from '@/components/ui/types';

/** Locale bound formatters for the cards; currencies always come from the payload, never from code. */
export function useWidgetFormat() {
  const locale = useLocale();
  return useMemo(() => {
    const number = new Intl.NumberFormat(locale);
    const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
    const signedPercent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    const dayTime = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' });
    const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    const dateKeyDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return {
      locale,
      number: (value: number) => number.format(value),
      percent: (ratio: number) => percent.format(ratio),
      signedPercent: (ratio: number) => signedPercent.format(ratio),
      money: (amount: string, currency: string) => formatMoney(amount, currency, locale),
      compactMoney: (amount: string, currency: string) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(Number(amount)),
      time: (iso: string) => time.format(new Date(iso)),
      dayTime: (iso: string) => dayTime.format(new Date(iso)),
      day: (iso: string) => day.format(new Date(iso)),
      weekday: (date: Date) => weekday.format(date),
      /** A `YYYY-MM-DD` key (already a calendar day in the studio zone) as a short date. */
      dateKey: (key: string) => dateKeyDay.format(new Date(`${key}T00:00:00Z`)),
      /** A `YYYY-MM` key as a short month name. */
      monthKey: (key: string) => month.format(new Date(`${key}-01T00:00:00Z`)),
    };
  }, [locale]);
}

export type WidgetFormat = ReturnType<typeof useWidgetFormat>;

export function periodLabelKey(period: DashboardPeriod): string {
  return `dashboard.period.${period}`;
}

/** The change line under a KPI: arrow and signed percentage in the success or error color, or a quiet "no comparison". */
export function Comparison({ change, invert = false }: { change: number | null; invert?: boolean }) {
  const t = useT();
  const f = useWidgetFormat();
  if (change === null || !Number.isFinite(change)) return <span className="ui-caption">{t('dashboard.kpi.noComparison')}</span>;
  const up = change > 0;
  const good = invert ? !up : up;
  const tone = change === 0 ? 'ui-text-muted' : good ? 'ui-text-success' : 'ui-text-error';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cx('ui-small inline-flex items-center gap-1 min-w-0', tone)}>
      {change !== 0 ? <Icon className="ui-icon" aria-hidden="true" /> : null}
      <span className="ui-strong ui-tabular">{f.signedPercent(change)}</span>
      <span className="ui-caption truncate">{t('dashboard.kpi.vsPrevious')}</span>
    </span>
  );
}

/** A KPI card body: the figure, an optional comparison and one hint line that hides on very narrow cards. */
export function KpiBody({ value, title, comparison, hint }: { value: string; title?: string; comparison?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1 content-start min-w-0">
      <span className="ui-kpi-value" title={title ?? value}>
        {value}
      </span>
      {comparison ? <div className="flex min-w-0">{comparison}</div> : null}
      {hint ? <div className="ui-caption ui-kpi-hint truncate">{hint}</div> : null}
    </div>
  );
}

/** Live size of an element (ResizeObserver), for charts that redraw to their container. */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      setSize((prev) => (Math.abs(prev.width - box.width) < 1 && Math.abs(prev.height - box.height) < 1 ? prev : { width: box.width, height: box.height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}
