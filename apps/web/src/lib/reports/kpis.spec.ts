import type { MembersReportDTO, OccupancyReportDTO, RenewalReportDTO, RevenueReportDTO, TrainerReportDTO } from '@platform/shared';
import { extractReportKpis } from './kpis';

describe('extractReportKpis', () => {
  it('returns nothing when there is no report yet', () => {
    expect(extractReportKpis('members', null)).toEqual([]);
  });

  it('always returns nothing for cohorts (no date range)', () => {
    expect(extractReportKpis('cohorts', { cohorts: [] })).toEqual([]);
  });

  it('reads members KPIs straight from the DTO', () => {
    const report: MembersReportDTO = { from: '2026-01-01', to: '2026-01-31', activeMembers: 40, newMembers: 5, churnedMembers: 2, revenue: '1000.00', arpu: '25.00' };
    const kpis = extractReportKpis('members', report);
    expect(kpis.find((k) => k.key === 'active')?.value).toBe(40);
    expect(kpis.find((k) => k.key === 'revenue')?.value).toBe(1000);
    expect(kpis.find((k) => k.key === 'arpu')?.value).toBe(25);
  });

  it('reads renewal KPIs straight from the DTO', () => {
    const report: RenewalReportDTO = { from: '2026-01-01', to: '2026-01-31', expiredPackages: 10, renewedPackages: 6, renewalRate: 0.6 };
    const kpis = extractReportKpis('renewal', report);
    expect(kpis.find((k) => k.key === 'rate')?.value).toBe(0.6);
  });

  it('reads revenue totals as numbers from the string amounts', () => {
    const report: RevenueReportDTO = {
      from: '2026-01-01',
      to: '2026-01-31',
      granularity: 'day',
      total: '5000.00',
      byPeriod: [],
      byMethod: [],
      byPackage: [],
      refundTotal: '200.00',
      netTotal: '4800.00',
    };
    const kpis = extractReportKpis('revenue', report);
    expect(kpis.find((k) => k.key === 'gross')?.value).toBe(5000);
    expect(kpis.find((k) => k.key === 'refund')?.value).toBe(200);
    expect(kpis.find((k) => k.key === 'net')?.value).toBe(4800);
  });

  it('aggregates occupancy across days into totals and a weighted occupancy ratio', () => {
    const report: OccupancyReportDTO = {
      from: '2026-01-01',
      to: '2026-01-02',
      byDay: [
        { date: '2026-01-01', sessions: 3, capacity: 30, booked: 15, attended: 12, occupancy: 0.5 },
        { date: '2026-01-02', sessions: 2, capacity: 20, booked: 10, attended: 9, occupancy: 0.5 },
      ],
      byServiceType: [],
      heatmap: [],
    };
    const kpis = extractReportKpis('occupancy', report);
    expect(kpis.find((k) => k.key === 'sessions')?.value).toBe(5);
    expect(kpis.find((k) => k.key === 'occupancy')?.value).toBeCloseTo(25 / 50);
  });

  it('is 0 occupancy (not NaN) when there is no capacity at all', () => {
    const report: OccupancyReportDTO = { from: '2026-01-01', to: '2026-01-01', byDay: [], byServiceType: [], heatmap: [] };
    const kpis = extractReportKpis('occupancy', report);
    expect(kpis.find((k) => k.key === 'occupancy')?.value).toBe(0);
  });

  it('aggregates trainer rows into totals and a weighted occupancy ratio', () => {
    const report: TrainerReportDTO = {
      from: '2026-01-01',
      to: '2026-01-31',
      trainers: [
        { trainerProfileId: 't1', trainerName: 'A', sessions: 4, capacity: 40, booked: 20, attended: 18, occupancy: 0.5, noShows: 1, lateCancellations: 0, substitutions: 0 },
        { trainerProfileId: 't2', trainerName: 'B', sessions: 6, capacity: 60, booked: 30, attended: 28, occupancy: 0.5, noShows: 0, lateCancellations: 1, substitutions: 0 },
      ],
    };
    const kpis = extractReportKpis('trainers', report);
    expect(kpis.find((k) => k.key === 'sessions')?.value).toBe(10);
    expect(kpis.find((k) => k.key === 'attended')?.value).toBe(46);
    expect(kpis.find((k) => k.key === 'occupancy')?.value).toBeCloseTo(50 / 100);
  });
});
