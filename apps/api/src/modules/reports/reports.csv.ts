import type {
  CohortReportDTO,
  MembersReportDTO,
  OccupancyReportDTO,
  RenewalReportDTO,
  RevenueReportDTO,
  TrainerReportDTO,
} from '@platform/shared';
import { toCsv } from '../../common/csv';

const percent = (v: number) => `%${Math.round(v * 100)}`;

export function occupancyToCsv(report: OccupancyReportDTO): string {
  const rows = report.byDay.map((r) => [r.date, r.sessions, r.capacity, r.booked, r.attended, percent(r.occupancy)]);
  return toCsv(['Tarih', 'Seans', 'Kapasite', 'Rezervasyon', 'Katılım', 'Doluluk'], rows);
}

export function revenueToCsv(report: RevenueReportDTO): string {
  const rows = report.byPeriod.map((r) => [r.period, r.amount, r.paymentCount]);
  return toCsv(['Dönem', 'Tutar', 'Ödeme Sayısı'], rows);
}

export function membersToCsv(report: MembersReportDTO): string {
  const rows = [
    ['Aktif üye', report.activeMembers],
    ['Yeni üye', report.newMembers],
    ['Kaybedilen üye', report.churnedMembers],
    ['Gelir', report.revenue],
    ['Üye başına gelir (ARPU)', report.arpu],
  ];
  return toCsv(['Metrik', 'Değer'], rows);
}

export function renewalToCsv(report: RenewalReportDTO): string {
  const rows = [
    ['Süresi biten paket', report.expiredPackages],
    ['Yenilenen paket', report.renewedPackages],
    ['Yenileme oranı', percent(report.renewalRate)],
  ];
  return toCsv(['Metrik', 'Değer'], rows);
}

export function cohortsToCsv(report: CohortReportDTO): string {
  const monthCount = report.cohorts.reduce((max, c) => Math.max(max, c.retention.length), 0);
  const headers = ['Kohort Ayı', 'Kohort Büyüklüğü', ...Array.from({ length: monthCount }, (_, i) => `${i}. ay`)];
  const rows = report.cohorts.map((c) => [c.cohortMonth, c.cohortSize, ...c.retention.map(percent)]);
  return toCsv(headers, rows);
}

export function trainersToCsv(report: TrainerReportDTO): string {
  const rows = report.trainers.map((t) => [
    t.trainerName,
    t.sessions,
    t.capacity,
    t.booked,
    t.attended,
    percent(t.occupancy),
    t.noShows,
    t.lateCancellations,
    t.substitutions,
  ]);
  return toCsv(
    ['Eğitmen', 'Seans', 'Kapasite', 'Rezervasyon', 'Katılım', 'Doluluk', 'Gelmedi', 'Geç İptal', 'Vekalet'],
    rows,
  );
}
