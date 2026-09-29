'use client';

import type { MembersReportDTO } from '@platform/shared';
import { useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { StatTile } from './Bar';

type MembersReport = MembersReportDTO;

export function MembersReport({ report, loading, error }: { report: MembersReport | null; loading: boolean; error: string | null }) {
  const t = useT();
  const formatMoney = useFormatMoney();
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <StatTile label={t('reports.members.active')} value={String(report.activeMembers)} />
      <StatTile label={t('reports.members.new')} value={String(report.newMembers)} />
      <StatTile label={t('reports.members.churned')} value={String(report.churnedMembers)} />
      <StatTile label={t('reports.members.revenue')} value={formatMoney(report.revenue)} />
      <StatTile label={t('reports.members.arpu')} value={formatMoney(report.arpu)} />
    </div>
  );
}
