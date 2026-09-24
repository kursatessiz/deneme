'use client';

import type { RenewalReportDTO } from '@platform/shared';
import { formatPercent } from '@/lib/money';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { StatTile } from './Bar';

type RenewalReport = RenewalReportDTO;

export function RenewalReport({ report, loading, error }: { report: RenewalReport | null; loading: boolean; error: string | null }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatTile label="Biten paket" value={String(report.expiredPackages)} />
        <StatTile label="Yenilenen paket" value={String(report.renewedPackages)} />
        <StatTile label="Yenileme oranı" value={formatPercent(report.renewalRate, 1)} />
      </div>
      <div className="h-2.5 rounded-full overflow-hidden max-w-md" style={{ backgroundColor: 'var(--color-surface-muted)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, report.renewalRate * 100)}%`, background: 'var(--gradient-brand)' }} />
      </div>
    </div>
  );
}
