import { SiteAggregateRatingService } from './site-aggregate-rating.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('SiteAggregateRatingService', () => {
  function make(rows: Record<string, { count: number; avg: number | null }>) {
    const aggregate = jest.fn(async (args: { where: { studioId: string; score?: unknown } }) => {
      const row = rows[args.where.studioId] ?? { count: 0, avg: null };
      return { _count: { _all: row.count }, _avg: { score: row.avg } };
    });
    const service = new SiteAggregateRatingService({ sessionRating: { aggregate } } as unknown as PrismaService);
    return { service, aggregate };
  }

  it('publishes the real mean and count from five ratings on', async () => {
    const { service } = make({ zen: { count: 12, avg: 4.5833 } });
    expect(await service.forStudio('zen')).toEqual({ ratingValue: 4.6, reviewCount: 12, bestRating: 5 });
  });

  it('publishes nothing below five ratings or without any', async () => {
    const { service } = make({ few: { count: 4, avg: 5 }, none: { count: 0, avg: null } });
    expect(await service.forStudio('few')).toBeNull();
    expect(await service.forStudio('none')).toBeNull();
  });

  it('scopes the query to the studio and keeps studios apart', async () => {
    const { service, aggregate } = make({ a: { count: 10, avg: 5 }, b: { count: 5, avg: 3 } });
    expect((await service.forStudio('a'))?.ratingValue).toBe(5);
    expect((await service.forStudio('b'))?.ratingValue).toBe(3);
    const wheres = aggregate.mock.calls.map((c) => c[0].where);
    expect(wheres.map((w) => w.studioId)).toEqual(['a', 'b']);
    expect(wheres.every((w) => w.score !== undefined)).toBe(true);
  });

  it('caches per studio for ten minutes', async () => {
    const { service, aggregate } = make({ zen: { count: 6, avg: 4 } });
    await service.forStudio('zen', 0);
    await service.forStudio('zen', 9 * 60 * 1000);
    expect(aggregate).toHaveBeenCalledTimes(1);
    await service.forStudio('zen', 11 * 60 * 1000);
    expect(aggregate).toHaveBeenCalledTimes(2);
  });
});
