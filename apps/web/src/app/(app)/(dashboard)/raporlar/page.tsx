'use client';

import { useEffect, useState } from 'react';
import type { CohortReportDTO, MembersReportDTO, OccupancyReportDTO, RenewalReportDTO, RevenueReportDTO, TrainerReportDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
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
import { CompareStrip } from '@/components/reports/CompareStrip';
import { FunnelsTab } from '@/components/reports/FunnelsTab';
import { previousPeriodWindow } from '@/lib/reports/compare';
import { extractReportKpis } from '@/lib/reports/kpis';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select } from '@/components/ui/Select';
import { AnchorButton } from '@/components/ui/LinkButton';
import { PageHeader } from '@/components/ui/PageHeader';

const REPORT_KEYS = ['occupancy', 'revenue', 'members', 'renewal', 'cohorts', 'trainers', 'funnels'] as const;

type ReportKey = (typeof REPORT_KEYS)[number];

type AnyReport = OccupancyReportDTO | RevenueReportDTO | MembersReportDTO | RenewalReportDTO | CohortReportDTO | TrainerReportDTO;

function ReportsPage() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [tab, setTab] = useState<ReportKey>('occupancy');
  const reportTabs = REPORT_KEYS.map((key) => ({ key, label: t(`reports.tabs.${key}`) }));
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [report, setReport] = useState<AnyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [previousReport, setPreviousReport] = useState<AnyReport | null>(null);

  useEffect(() => {
    // The funnels tab loads its own data (FunnelsTab).
    if (!activeStudioId || tab === 'funnels') return;
    setLoading(true);
    setError(null);
    const filters =
      tab === 'cohorts' ? { branchId: branchId || null } : { from, to, branchId: branchId || null, granularity: tab === 'revenue' ? granularity : undefined };
    const path = `reports/studio/${activeStudioId}/${tab}`;
    const qs = buildReportQuery(filters);
    bffFetch<AnyReport>(`${path}${qs ? `?${qs}` : ''}`, { studioId: activeStudioId })
      .then(setReport)
      .catch((err) => setError(err instanceof BffError ? err.message : t('reports.errors.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, tab, branchId, from, to, granularity]);

  // Second call for the "compare with previous period" toggle: same
  // endpoint and filters, only the date window shifts to the same-length
  // window immediately before the selected one. Cohorts has no date range,
  // so it is never comparable.
  useEffect(() => {
    if (!activeStudioId || !compare || tab === 'cohorts' || tab === 'funnels' || !from || !to) {
      setPreviousReport(null);
      return;
    }
    let cancelled = false;
    const { from: prevFrom, to: prevTo } = previousPeriodWindow({ from, to });
    const filters = { from: prevFrom, to: prevTo, branchId: branchId || null, granularity: tab === 'revenue' ? granularity : undefined };
    const path = `reports/studio/${activeStudioId}/${tab}`;
    const qs = buildReportQuery(filters);
    bffFetch<AnyReport>(`${path}${qs ? `?${qs}` : ''}`, { studioId: activeStudioId })
      .then((res) => {
        if (!cancelled) setPreviousReport(res);
      })
      .catch(() => {
        if (!cancelled) setPreviousReport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStudioId, compare, tab, branchId, from, to, granularity]);

  const exportHref = (() => {
    if (!activeStudioId || tab === 'funnels') return '#';
    const filters =
      tab === 'cohorts'
        ? { branchId: branchId || null, format: 'csv' as const }
        : { from, to, branchId: branchId || null, granularity: tab === 'revenue' ? granularity : undefined, format: 'csv' as const };
    const qs = buildReportQuery(filters);
    return `/api/bff/reports/studio/${activeStudioId}/${tab}${qs ? `?${qs}` : ''}`;
  })();

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('reports.title')}
        description={t('reports.subtitle')}
        actions={
          tab !== 'funnels' ? (
            <AnchorButton href={exportHref} variant="outline" tone="surface" size="sm">
              {t('reports.downloadCsv')}
            </AnchorButton>
          ) : undefined
        }
      />

      <Tabs
        tabs={reportTabs}
        active={tab}
        onChange={(k) => {
          // Clear the previous tab's report immediately: otherwise the next
          // render paints this tab's component with the old tab's report
          // shape for one frame (the refetch only starts in an effect after
          // this render), and e.g. RevenueReport.byPeriod.map() throws on
          // an OccupancyReportDTO.
          setReport(null);
          setTab(k as ReportKey);
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        {tab !== 'cohorts' && (
          <DateRangeFilter
            from={from}
            to={to}
            onChange={({ from: f, to: newTo }) => {
              setFrom(f);
              setTo(newTo);
            }}
          />
        )}
        <BranchSelect value={branchId} onChange={setBranchId} />
        {tab === 'revenue' && (
          <Select value={granularity} onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')}>
            <option value="day">{t('reports.granularity.day')}</option>
            <option value="week">{t('reports.granularity.week')}</option>
            <option value="month">{t('reports.granularity.month')}</option>
          </Select>
        )}
        {tab !== 'cohorts' && (
          <Checkbox
            label={t('reports.compare.toggle')}
            className="ui-caption ui-strong ml-auto"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
          />
        )}
      </div>

      {compare && tab !== 'cohorts' && tab !== 'funnels' && (
        <CompareStrip current={extractReportKpis(tab, report)} previous={extractReportKpis(tab, previousReport)} />
      )}

      {/*
        `report` is refetched whenever `tab` changes and is only ever set from
        that tab's own endpoint (see the effect above), so it always matches
        the shape the active tab's component expects; the per-tab cast below
        just tells TypeScript what the tab check above already guarantees.
      */}
      {tab === 'funnels' && <FunnelsTab from={from} to={to} branchId={branchId} compare={compare} />}
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
