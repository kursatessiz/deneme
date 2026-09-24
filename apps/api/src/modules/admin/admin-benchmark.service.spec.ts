import { AdminBenchmarkService } from './admin-benchmark.service';

function makePrisma(studioIds: string[]) {
  return {
    businessTypeTemplate: {
      findMany: jest.fn().mockResolvedValue([
        { key: 'pilates_studio', name: 'Pilates Stüdyosu', studios: studioIds.map((id) => ({ id })) },
      ]),
    },
    sessionSchedule: { aggregate: jest.fn().mockResolvedValue({ _sum: { capacity: 100, bookedCount: 80 } }) },
    booking: { count: jest.fn().mockResolvedValue(10) },
    payment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1000 } }) },
    membership: { count: jest.fn().mockResolvedValue(20) },
    memberSubscription: { count: jest.fn().mockResolvedValue(5) },
  };
}

describe('AdminBenchmarkService k-anonymity', () => {
  it('suppresses a bucket with fewer than 5 studios', async () => {
    const prisma = makePrisma(['s1', 's2', 's3', 's4']);
    const service = new AdminBenchmarkService(prisma as never);
    const buckets = await service.compute();

    expect(buckets).toHaveLength(1);
    expect(buckets[0].suppressed).toBe(true);
    expect(buckets[0].studioCount).toBe(4);
    expect(buckets[0].avgOccupancyRate).toBeNull();
    expect(buckets[0].avgCancellationRate).toBeNull();
    expect(buckets[0].avgRevenuePerMember).toBeNull();
    expect(buckets[0].avgRenewalRate).toBeNull();
    // No per-studio metric queries should run for a suppressed bucket.
    expect(prisma.sessionSchedule.aggregate).not.toHaveBeenCalled();
  });

  it('publishes a bucket with exactly the minimum group size (5 studios)', async () => {
    const prisma = makePrisma(['s1', 's2', 's3', 's4', 's5']);
    const service = new AdminBenchmarkService(prisma as never);
    const buckets = await service.compute();

    expect(buckets[0].suppressed).toBe(false);
    expect(buckets[0].studioCount).toBe(5);
    expect(buckets[0].avgOccupancyRate).toBeCloseTo(0.8);
    expect(prisma.sessionSchedule.aggregate).toHaveBeenCalledTimes(5);
  });
});
