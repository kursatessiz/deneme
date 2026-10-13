import { ChurnService } from './churn.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('ChurnService.recomputeStale', () => {
  it('keeps scoring the remaining studios when one studio throws', async () => {
    const prisma = {
      studio: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]) },
      memberRiskSnapshot: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const errors = { capture: jest.fn() };
    const service = new ChurnService(prisma as unknown as PrismaService, errors as never);
    jest.spyOn(service, 'recomputeStudio').mockImplementation(async (studioId: string) => {
      if (studioId === 's1') throw new Error('boom');
      return { membersScored: 4 } as Awaited<ReturnType<ChurnService['recomputeStudio']>>;
    });

    await expect(service.recomputeStale(new Date())).resolves.toEqual({ studiosProcessed: 1, membersScored: 4 });
    expect(errors.capture).toHaveBeenCalledWith(expect.objectContaining({ source: 'job', studioId: 's1' }));
  });
});
