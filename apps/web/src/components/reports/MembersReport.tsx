'use client';

import type { MembersReportDTO } from '@platform/shared';
import { formatMoney } from '@/lib/money';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { StatTile } from './Bar';

type MembersReport = MembersReportDTO;

export function MembersReport({ report, loading, error }: { report: MembersReport | null; loading: boolean; error: string | null }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <StatTile label="Aktif üye" value={String(report.activeMembers)} />
      <StatTile label="Yeni üye" value={String(report.newMembers)} />
      <StatTile label="Kaybedilen üye" value={String(report.churnedMembers)} />
      <StatTile label="Gelir" value={formatMoney(report.revenue)} />
      <StatTile label="Üye başına gelir (ARPU)" value={formatMoney(report.arpu)} />
    </div>
  );
}
