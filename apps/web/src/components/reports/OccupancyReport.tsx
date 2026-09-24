'use client';

import { Fragment } from 'react';
import type { OccupancyReportDTO } from '@platform/shared';
import { formatPercent } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { Bar } from './Bar';

type OccupancyReport = OccupancyReportDTO;

const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function heatColor(occupancy: number): string {
  if (occupancy <= 0) return 'var(--color-surface-muted)';
  const alpha = Math.min(1, 0.15 + occupancy * 0.75);
  return `rgba(var(--color-primary-rgb, 99, 102, 241), ${alpha})`;
}

export function OccupancyReport({ report, loading, error }: { report: OccupancyReport | null; loading: boolean; error: string | null }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report || report.byDay.length === 0) return <EmptyState title="Veri yok" description="Seçili aralıkta seans bulunamadı." />;

  const maxOccupancy = Math.max(...report.byServiceType.map((s) => s.occupancy), 0.0001);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
          Hizmet türüne göre doluluk
        </h3>
        <div className="space-y-2">
          {report.byServiceType.map((s) => (
            <Bar key={s.serviceTypeId} label={s.serviceTypeName} value={s.occupancy} max={maxOccupancy} valueLabel={formatPercent(s.occupancy)} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
          Isı haritası (gün x saat)
        </h3>
        <div className="overflow-x-auto">
          <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `40px repeat(24, 14px)` }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-[9px] text-center" style={{ color: 'var(--color-text-muted)' }}>
                {h % 3 === 0 ? h : ''}
              </div>
            ))}
            {WEEKDAY_LABELS.map((label, weekday) => (
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
          Güne göre
        </h3>
        <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {['Tarih', 'Seans', 'Kapasite', 'Rezervasyon', 'Katılım', 'Doluluk'].map((h) => (
                  <th key={h} className="text-left px-4 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.byDay.map((d) => (
                <tr key={d.date} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text-primary)' }}>
                    {new Date(d.date).toLocaleDateString('tr-TR')}
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
