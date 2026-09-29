'use client';

import type { TrainerReportDTO } from '@platform/shared';
import { formatPercent as formatPercentShared } from '@/lib/money';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';

type TrainersReport = TrainerReportDTO;

export function TrainersReport({ report, loading, error }: { report: TrainersReport | null; loading: boolean; error: string | null }) {
  const t = useT();
  const locale = useLocale();
  const formatPercent = (ratio: number | null | undefined, fractionDigits?: number) => formatPercentShared(ratio, locale, fractionDigits);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report || report.trainers.length === 0) return <EmptyState title={t('reports.empty.title')} />;

  return (
    <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
            {[
              t('reports.trainers.col.trainer'),
              t('reports.trainers.col.sessions'),
              t('reports.trainers.col.booked'),
              t('reports.trainers.col.attended'),
              t('reports.trainers.col.occupancy'),
              t('reports.trainers.col.noShows'),
              t('reports.trainers.col.lateCancellations'),
              t('reports.trainers.col.substitutions'),
            ].map((h, i) => (
              <th key={i} className="text-left px-4 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.trainers.map((row) => (
            <tr key={row.trainerProfileId} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-primary)' }}>
                {row.trainerName}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {row.sessions}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {row.booked}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {row.attended}
              </td>
              <td className="px-4 py-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {formatPercent(row.occupancy)}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {row.noShows}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {row.lateCancellations}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {row.substitutions}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
