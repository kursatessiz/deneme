'use client';

import type { DashboardWidgetPayload } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { BarChart, LineChart } from './Charts';
import { useWidgetFormat } from './common';

type Payload<K extends DashboardWidgetPayload['kind']> = Extract<DashboardWidgetPayload, { kind: K }>;

/** Daily net revenue of the period as a line, with the period total above it. */
export function RevenueTrendChart({ data }: { data: Payload<'revenueTrend'> }) {
  const t = useT();
  const f = useWidgetFormat();
  const total = f.money(data.total, data.currency);
  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="ui-strong ui-tabular truncate" title={total}>
          {total}
        </span>
        <span className="ui-caption truncate">{t('dashboard.chart.total')}</span>
      </div>
      <div className="flex-1 min-h-0">
        <LineChart
          label={t('dashboard.chart.revenueLabel', { total })}
          formatTick={(v) => f.compactMoney(String(v), data.currency)}
          points={data.points.map((p) => ({ label: f.dateKey(p.date), value: Number(p.amount), tooltip: `${f.dateKey(p.date)}: ${f.money(p.amount, data.currency)}` }))}
        />
      </div>
    </div>
  );
}

export function OccupancyTrendChart({ data }: { data: Payload<'occupancyTrend'> }) {
  const t = useT();
  const f = useWidgetFormat();
  const booked = data.points.reduce((a, p) => a + p.booked, 0);
  const capacity = data.points.reduce((a, p) => a + p.capacity, 0);
  const average = capacity > 0 ? booked / capacity : 0;
  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="ui-strong ui-tabular">{f.percent(average)}</span>
        <span className="ui-caption truncate">{t('dashboard.chart.average')}</span>
      </div>
      <div className="flex-1 min-h-0">
        <BarChart
          max={1}
          label={t('dashboard.chart.occupancyLabel', { average: f.percent(average) })}
          formatTick={(v) => f.percent(v)}
          points={data.points.map((p) => ({
            label: f.dateKey(p.date),
            value: p.rate,
            tooltip: `${f.dateKey(p.date)}: ${f.percent(p.rate)} (${t('dashboard.kpi.seats', { booked: f.number(p.booked), capacity: f.number(p.capacity) })})`,
          }))}
        />
      </div>
    </div>
  );
}

export function MemberGrowthChart({ data }: { data: Payload<'memberGrowthChart'> }) {
  const t = useT();
  const f = useWidgetFormat();
  const total = data.points.reduce((a, p) => a + p.joined, 0);
  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="ui-strong ui-tabular">{f.number(total)}</span>
        <span className="ui-caption truncate">{t('dashboard.chart.joinedTotal', { months: data.points.length })}</span>
      </div>
      <div className="flex-1 min-h-0">
        <BarChart
          label={t('dashboard.chart.growthLabel', { total: f.number(total) })}
          formatTick={(v) => f.number(Math.round(v))}
          points={data.points.map((p) => ({ label: f.monthKey(p.month), value: p.joined, tooltip: `${f.monthKey(p.month)}: ${f.number(p.joined)}` }))}
        />
      </div>
    </div>
  );
}
