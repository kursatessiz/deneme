'use client';

import type { CohortReportDTO } from '@platform/shared';
import { formatPercent } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';

type CohortsReport = CohortReportDTO;

function cellColor(ratio: number): string {
  if (ratio <= 0) return 'var(--color-surface-muted)';
  const alpha = Math.min(1, 0.12 + ratio * 0.7);
  return `rgba(var(--color-primary-rgb, 99, 102, 241), ${alpha})`;
}

export function CohortsReport({ report, loading, error }: { report: CohortsReport | null; loading: boolean; error: string | null }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report || report.cohorts.length === 0) return <EmptyState title="Veri yok" description="Henüz kohort oluşturacak paket satışı yok." />;

  const maxMonths = Math.max(...report.cohorts.map((c) => c.retention.length));

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left px-3 py-2 font-medium sticky left-0" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
              Kohort
            </th>
            <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Üye
            </th>
            {Array.from({ length: maxMonths }, (_, i) => (
              <th key={i} className="text-center px-2 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Ay {i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.cohorts.map((c) => (
            <tr key={c.cohortMonth}>
              <td className="px-3 py-1.5 font-medium sticky left-0" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }}>
                {c.cohortMonth}
              </td>
              <td className="px-3 py-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                {c.cohortSize}
              </td>
              {Array.from({ length: maxMonths }, (_, i) => {
                const ratio = c.retention[i];
                return (
                  <td key={i} className="text-center px-1 py-1.5">
                    {ratio !== undefined ? (
                      <span
                        className="inline-block px-2 py-1 rounded"
                        style={{ backgroundColor: cellColor(ratio), color: 'var(--color-text-primary)' }}
                      >
                        {formatPercent(ratio)}
                      </span>
                    ) : (
                      ''
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
