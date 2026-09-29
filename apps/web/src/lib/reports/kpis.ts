import type {
  CohortReportDTO,
  MembersReportDTO,
  MessageKey,
  OccupancyReportDTO,
  RenewalReportDTO,
  RevenueReportDTO,
  TrainerReportDTO,
} from '@platform/shared';

export type ReportTabKey = 'occupancy' | 'revenue' | 'members' | 'renewal' | 'cohorts' | 'trainers';

export type AnyReportDTO = OccupancyReportDTO | RevenueReportDTO | MembersReportDTO | RenewalReportDTO | CohortReportDTO | TrainerReportDTO;

export type ReportKpiFormat = 'number' | 'money' | 'percent';

export interface ReportKpi {
  key: string;
  labelKey: MessageKey;
  format: ReportKpiFormat;
  value: number;
}

/**
 * The handful of top-level KPIs each report tab exposes for the "compare
 * with previous period" strip on /raporlar. Pure and report-shape aware, so
 * the page and its tests can reuse it without re-deriving the aggregates.
 * Cohorts has no date range (it never gets a previous-period fetch either),
 * so it always returns no KPIs.
 */
export function extractReportKpis(tab: ReportTabKey, report: AnyReportDTO | null): ReportKpi[] {
  if (!report) return [];
  switch (tab) {
    case 'occupancy': {
      const r = report as OccupancyReportDTO;
      const totalSessions = r.byDay.reduce((sum, d) => sum + d.sessions, 0);
      const totalCapacity = r.byDay.reduce((sum, d) => sum + d.capacity, 0);
      const totalBooked = r.byDay.reduce((sum, d) => sum + d.booked, 0);
      return [
        { key: 'sessions', labelKey: 'reports.occupancy.col.sessions', format: 'number', value: totalSessions },
        { key: 'occupancy', labelKey: 'reports.occupancy.col.occupancy', format: 'percent', value: totalCapacity > 0 ? totalBooked / totalCapacity : 0 },
      ];
    }
    case 'revenue': {
      const r = report as RevenueReportDTO;
      return [
        { key: 'gross', labelKey: 'reports.revenue.gross', format: 'money', value: Number(r.total) },
        { key: 'refund', labelKey: 'reports.revenue.refund', format: 'money', value: Number(r.refundTotal) },
        { key: 'net', labelKey: 'reports.revenue.net', format: 'money', value: Number(r.netTotal) },
      ];
    }
    case 'members': {
      const r = report as MembersReportDTO;
      return [
        { key: 'active', labelKey: 'reports.members.active', format: 'number', value: r.activeMembers },
        { key: 'new', labelKey: 'reports.members.new', format: 'number', value: r.newMembers },
        { key: 'churned', labelKey: 'reports.members.churned', format: 'number', value: r.churnedMembers },
        { key: 'revenue', labelKey: 'reports.members.revenue', format: 'money', value: Number(r.revenue) },
        { key: 'arpu', labelKey: 'reports.members.arpu', format: 'money', value: Number(r.arpu) },
      ];
    }
    case 'renewal': {
      const r = report as RenewalReportDTO;
      return [
        { key: 'expired', labelKey: 'reports.renewal.expired', format: 'number', value: r.expiredPackages },
        { key: 'renewed', labelKey: 'reports.renewal.renewed', format: 'number', value: r.renewedPackages },
        { key: 'rate', labelKey: 'reports.renewal.rate', format: 'percent', value: r.renewalRate },
      ];
    }
    case 'trainers': {
      const r = report as TrainerReportDTO;
      const totalSessions = r.trainers.reduce((sum, tr) => sum + tr.sessions, 0);
      const totalAttended = r.trainers.reduce((sum, tr) => sum + tr.attended, 0);
      const totalCapacity = r.trainers.reduce((sum, tr) => sum + tr.capacity, 0);
      const totalBooked = r.trainers.reduce((sum, tr) => sum + tr.booked, 0);
      return [
        { key: 'sessions', labelKey: 'reports.trainers.col.sessions', format: 'number', value: totalSessions },
        { key: 'attended', labelKey: 'reports.trainers.col.attended', format: 'number', value: totalAttended },
        { key: 'occupancy', labelKey: 'reports.trainers.col.occupancy', format: 'percent', value: totalCapacity > 0 ? totalBooked / totalCapacity : 0 },
      ];
    }
    case 'cohorts':
    default:
      return [];
  }
}
