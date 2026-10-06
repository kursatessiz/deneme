import type {
  CohortReportDTO,
  MembersReportDTO,
  OccupancyReportDTO,
  RenewalReportDTO,
  RevenueReportDTO,
  TrainerReportDTO,
} from '@platform/shared';
import { toCsv } from '../../common/csv';
import { requestT } from '../../common/server-i18n';
import type { ServerT } from '../../common/server-i18n';

const percent = (v: number) => `%${Math.round(v * 100)}`;

/** Column headers and metric names follow the language of the request (`t` defaults to it). */
export function occupancyToCsv(report: OccupancyReportDTO, t: ServerT = requestT()): string {
  const rows = report.byDay.map((r) => [r.date, r.sessions, r.capacity, r.booked, r.attended, percent(r.occupancy)]);
  return toCsv(
    [t('apiTexts.csv.date'), t('apiTexts.csv.sessions'), t('apiTexts.csv.capacity'), t('apiTexts.csv.bookings'), t('apiTexts.csv.attended'), t('apiTexts.csv.occupancy')],
    rows,
  );
}

export function revenueToCsv(report: RevenueReportDTO, t: ServerT = requestT()): string {
  const rows = report.byPeriod.map((r) => [r.period, r.amount, r.paymentCount]);
  return toCsv([t('apiTexts.csv.period'), t('apiTexts.csv.amount'), t('apiTexts.csv.paymentCount')], rows);
}

export function membersToCsv(report: MembersReportDTO, t: ServerT = requestT()): string {
  const rows = [
    [t('apiTexts.csv.activeMembers'), report.activeMembers],
    [t('apiTexts.csv.newMembers'), report.newMembers],
    [t('apiTexts.csv.churnedMembers'), report.churnedMembers],
    [t('apiTexts.csv.revenue'), report.revenue],
    [t('apiTexts.csv.arpu'), report.arpu],
  ];
  return toCsv([t('apiTexts.csv.metric'), t('apiTexts.csv.value')], rows);
}

export function renewalToCsv(report: RenewalReportDTO, t: ServerT = requestT()): string {
  const rows = [
    [t('apiTexts.csv.expiredPackages'), report.expiredPackages],
    [t('apiTexts.csv.renewedPackages'), report.renewedPackages],
    [t('apiTexts.csv.renewalRate'), percent(report.renewalRate)],
  ];
  return toCsv([t('apiTexts.csv.metric'), t('apiTexts.csv.value')], rows);
}

export function cohortsToCsv(report: CohortReportDTO, t: ServerT = requestT()): string {
  const monthCount = report.cohorts.reduce((max, c) => Math.max(max, c.retention.length), 0);
  const headers = [
    t('apiTexts.csv.cohortMonth'),
    t('apiTexts.csv.cohortSize'),
    ...Array.from({ length: monthCount }, (_, i) => t('apiTexts.csv.monthN', { n: i })),
  ];
  const rows = report.cohorts.map((c) => [c.cohortMonth, c.cohortSize, ...c.retention.map(percent)]);
  return toCsv(headers, rows);
}

export function trainersToCsv(report: TrainerReportDTO, t: ServerT = requestT()): string {
  const rows = report.trainers.map((tr) => [
    tr.trainerName,
    tr.sessions,
    tr.capacity,
    tr.booked,
    tr.attended,
    percent(tr.occupancy),
    tr.noShows,
    tr.lateCancellations,
    tr.substitutions,
  ]);
  return toCsv(
    [
      t('apiTexts.csv.trainer'),
      t('apiTexts.csv.sessions'),
      t('apiTexts.csv.capacity'),
      t('apiTexts.csv.bookings'),
      t('apiTexts.csv.attended'),
      t('apiTexts.csv.occupancy'),
      t('apiTexts.csv.noShows'),
      t('apiTexts.csv.lateCancellations'),
      t('apiTexts.csv.substitutions'),
    ],
    rows,
  );
}
