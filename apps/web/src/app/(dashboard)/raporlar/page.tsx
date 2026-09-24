'use client';

import { useEffect, useState } from 'react';
import type { CohortReportDTO, MembersReportDTO, OccupancyReportDTO, RenewalReportDTO, RevenueReportDTO, TrainerReportDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { buildReportQuery } from '@/lib/reports/query';
import { PageGuard } from '@/components/common/PageGuard';
import { Tabs } from '@/components/common/Tabs';
import { BranchSelect } from '@/components/common/BranchSelect';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { OccupancyReport } from '@/components/reports/OccupancyReport';
import { RevenueReport } from '@/components/reports/RevenueReport';
import { MembersReport } from '@/components/reports/MembersReport';
import { RenewalReport } from '@/components/reports/RenewalReport';
import { CohortsReport } from '@/components/reports/CohortsReport';
import { TrainersReport } from '@/components/reports/TrainersReport';

const REPORT_TABS = [
  { key: 'occupancy', label: 'Doluluk' },
  { key: 'revenue', label: 'Gelir' },
  { key: 'members', label: 'Üyeler' },
  { key: 'renewal', label: 'Yenileme' },
  { key: 'cohorts', label: 'Kohortlar' },
  { key: 'trainers', label: 'Eğitmenler' },
] as const;

type ReportKey = (typeof REPORT_TABS)[number]['key'];

type AnyReport = OccupancyReportDTO | RevenueReportDTO | MembersReportDTO | RenewalReportDTO | CohortReportDTO | TrainerReportDTO;

const selectStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function ReportsPage() {
  const { activeStudioId } = useDashboardSession();
  const [tab, setTab] = useState<ReportKey>('occupancy');
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [report, setReport] = useState<AnyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const filters = tab === 'cohorts' ? { branchId: branchId || null } : { from, to, branchId: branchId || null, granularity: tab === 'revenue' ? granularity : undefined };
    const path = `reports/studio/${activeStudioId}/${tab}`;
    const qs = buildReportQuery(filters);
    bffFetch<AnyReport>(`${path}${qs ? `?${qs}` : ''}`, { studioId: activeStudioId })
      .then(setReport)
      .catch((err) => setError(err instanceof BffError ? err.message : 'Rapor yüklenemedi'))
      .finally(() => setLoading(false));
  }, [activeStudioId, tab, branchId, from, to, granularity]);

  const exportHref = (() => {
    if (!activeStudioId) return '#';
    const filters =
      tab === 'cohorts'
        ? { branchId: branchId || null, format: 'csv' as const }
        : { from, to, branchId: branchId || null, granularity: tab === 'revenue' ? granularity : undefined, format: 'csv' as const };
    const qs = buildReportQuery(filters);
    return `/api/bff/reports/studio/${activeStudioId}/${tab}${qs ? `?${qs}` : ''}`;
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            Raporlar
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Doluluk, gelir, üye, yenileme, kohort ve eğitmen performansı
          </p>
        </div>
        <a href={exportHref} className="text-xs font-medium px-3 py-1.5" style={{ ...selectStyle, background: 'var(--color-surface-muted)' }}>
          CSV indir
        </a>
      </div>

      <Tabs tabs={REPORT_TABS} active={tab} onChange={(k) => setTab(k as ReportKey)} />

      <div className="flex flex-wrap items-center gap-2">
        {tab !== 'cohorts' && (
          <DateRangeFilter
            from={from}
            to={to}
            onChange={({ from: f, to: t }) => {
              setFrom(f);
              setTo(t);
            }}
          />
        )}
        <BranchSelect value={branchId} onChange={setBranchId} />
        {tab === 'revenue' && (
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')} className="text-xs px-2.5 py-1.5" style={selectStyle}>
            <option value="day">Günlük</option>
            <option value="week">Haftalık</option>
            <option value="month">Aylık</option>
          </select>
        )}
      </div>

      {/*
        `report` is refetched whenever `tab` changes and is only ever set from
        that tab's own endpoint (see the effect above), so it always matches
        the shape the active tab's component expects; the per-tab cast below
        just tells TypeScript what the tab check above already guarantees.
      */}
      {tab === 'occupancy' && <OccupancyReport report={report as OccupancyReportDTO | null} loading={loading} error={error} />}
      {tab === 'revenue' && <RevenueReport report={report as RevenueReportDTO | null} loading={loading} error={error} />}
      {tab === 'members' && <MembersReport report={report as MembersReportDTO | null} loading={loading} error={error} />}
      {tab === 'renewal' && <RenewalReport report={report as RenewalReportDTO | null} loading={loading} error={error} />}
      {tab === 'cohorts' && <CohortsReport report={report as CohortReportDTO | null} loading={loading} error={error} />}
      {tab === 'trainers' && <TrainersReport report={report as TrainerReportDTO | null} loading={loading} error={error} />}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['reports.view']}>
      <ReportsPage />
    </PageGuard>
  );
}
