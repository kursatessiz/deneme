'use client';

import { Fragment } from 'react';
import type { OccupancyReportDTO } from '@platform/shared';
import { formatPercent as formatPercentShared } from '@/lib/money';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { Bar } from './Bar';

type OccupancyReport = OccupancyReportDTO;

/** Reference week (an arbitrary Monday) used only to derive locale-correct short weekday labels. */
const REFERENCE_MONDAY = new Date(Date.UTC(2024, 0, 1));

function weekdayLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(REFERENCE_MONDAY);
    d.setUTCDate(REFERENCE_MONDAY.getUTCDate() + i);
    return formatter.format(d);
  });
}

function heatColor(occupancy: number): string {
  if (occupancy <= 0) return 'var(--color-surface-muted)';
  const alpha = Math.min(1, 0.15 + occupancy * 0.75);
  return `rgba(var(--color-primary-rgb, 99, 102, 241), ${alpha})`;
}

export function OccupancyReport({ report, loading, error }: { report: OccupancyReport | null; loading: boolean; error: string | null }) {
  const t = useT();
  const locale = useLocale();
  const formatPercent = (ratio: number | null | undefined, fractionDigits?: number) => formatPercentShared(ratio, locale, fractionDigits);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report || report.byDay.length === 0) return <EmptyState title={t('reports.empty.title')} description={t('reports.empty.rangeDescription')} />;

  const maxOccupancy = Math.max(...report.byServiceType.map((s) => s.occupancy), 0.0001);
  const labels = weekdayLabels(locale);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
          {t('reports.occupancy.byServiceType')}
        </h3>
        <div className="space-y-2">
          {report.byServiceType.map((s) => (
            <Bar key={s.serviceTypeId} label={s.serviceTypeName} value={s.occupancy} max={maxOccupancy} valueLabel={formatPercent(s.occupancy)} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
          {t('reports.occupancy.heatmap')}
        </h3>
        <div className="overflow-x-auto">
          <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `40px repeat(24, 14px)` }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-[9px] text-center" style={{ color: 'var(--color-text-muted)' }}>
                {h % 3 === 0 ? h : ''}
              </div>
            ))}
            {labels.map((label, weekday) => (
              <Fragment key={weekday}>
                <div className="text-[10px] flex items-center" style={{ color: 'var(--color-text-secondary)' }}>
                  {label}
                </div>
                {Array.from({ length: 24 }, (_, hour) => {
                  const cell = report.heatmap.find((c) => c.weekday === weekday && c.hour === hour);
                  return (
                    <div
                      key={`${weekday}-${hour}`}
                      title={`${label} ${hour}:00 - ${formatPercent(cell?.occupancy ?? 0)}`}
                      style={{ width: 14, height: 14, backgroundColor: heatColor(cell?.occupancy ?? 0), borderRadius: 2 }}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
          {t('reports.occupancy.byDay')}
        </h3>
        <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {[
                  t('reports.occupancy.col.date'),
                  t('reports.occupancy.col.sessions'),
                  t('reports.occupancy.col.capacity'),
                  t('reports.occupancy.col.booked'),
                  t('reports.occupancy.col.attended'),
                  t('reports.occupancy.col.occupancy'),
                ].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.byDay.map((d) => (
                <tr key={d.date} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text-primary)' }}>
                    {new Date(d.date).toLocaleDateString(locale)}
                  </td>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {d.sessions}
                  </td>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {d.capacity}
                  </td>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {d.booked}
                  </td>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {d.attended}
                  </td>
                  <td className="px-4 py-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {formatPercent(d.occupancy)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
