'use client';

import type { TrainerReportDTO } from '@platform/shared';
import { formatPercent } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';

type TrainersReport = TrainerReportDTO;

export function TrainersReport({ report, loading, error }: { report: TrainersReport | null; loading: boolean; error: string | null }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report || report.trainers.length === 0) return <EmptyState title="Veri yok" />;

  return (
    <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
            {['Eğitmen', 'Seans', 'Rezervasyon', 'Katılım', 'Doluluk', 'Gelmedi', 'Geç iptal', 'İkame'].map((h) => (
              <th key={h} className="text-left px-4 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.trainers.map((t) => (
            <tr key={t.trainerProfileId} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-primary)' }}>
                {t.trainerName}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {t.sessions}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {t.booked}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {t.attended}
              </td>
              <td className="px-4 py-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {formatPercent(t.occupancy)}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {t.noShows}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {t.lateCancellations}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                {t.substitutions}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
