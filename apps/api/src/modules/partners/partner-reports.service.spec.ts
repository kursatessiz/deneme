import { PartnerReportsService } from './partner-reports.service';
import type { TenantContext } from '../auth/tenant-context';
import type { PrismaService } from '../prisma/prisma.service';

const tenant = { studioId: 'studio-1' } as unknown as TenantContext;

function makeService(timezone: string, bookings: Array<{ status: string; start: string }>) {
  const findMany = jest.fn().mockResolvedValue(
    bookings.map((b) => ({ partnerConnectionId: 'c1', status: b.status, schedule: { startTime: new Date(b.start) } })),
  );
  const prisma = {
    studio: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone }) },
    partnerConnection: {
      findMany: jest.fn().mockResolvedValue([{ id: 'c1', provider: 'MOCK', label: 'Mock', config: { payoutRatePerVisit: '10.00' } }]),
    },
    booking: { findMany },
  } as unknown as PrismaService;
  return { service: new PartnerReportsService(prisma), findMany };
}

describe('PartnerReportsService.visits', () => {
  it('groups visits by the session month in the studio time zone, not by booking creation', async () => {
    const { service } = makeService('Europe/Istanbul', [
      { status: 'ATTENDED', start: '2026-02-03T10:00:00Z' }, // booked 28 Jan, held 3 Feb
      { status: 'ATTENDED', start: '2026-01-31T20:30:00Z' }, // 23:30 local on 31 Jan
      { status: 'ATTENDED', start: '2026-01-31T21:30:00Z' }, // 00:30 local on 1 Feb
    ]);
    const rows = await service.visits(tenant);
    expect(rows.map((r) => [r.month, r.visits, r.expectedPayout])).toEqual([
      ['2026-01', 1, '10.00'],
      ['2026-02', 2, '20.00'],
    ]);
  });

  it('applies the date range to the session start time', async () => {
    const { service, findMany } = makeService('Europe/Istanbul', []);
    const from = new Date('2026-02-01T00:00:00Z');
    await service.visits(tenant, from, undefined);
    expect(findMany.mock.calls[0][0].where.schedule).toEqual({ startTime: { gte: from } });
    expect(findMany.mock.calls[0][0].where.createdAt).toBeUndefined();
  });
});
