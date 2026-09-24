import { FirstClassFollowUpEvaluator } from './first-class-follow-up.evaluator';
import { PrismaService } from '../../prisma/prisma.service';

describe('FirstClassFollowUpEvaluator', () => {
  const now = new Date('2026-02-01T10:00:00.000Z');

  function buildPrisma(bookings: unknown[]) {
    return {
      booking: { findMany: jest.fn().mockResolvedValue(bookings) },
      studio: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Zen Reformer' }) },
    } as unknown as PrismaService;
  }

  it('includes a first booking whose follow-up window has elapsed', async () => {
    const prisma = buildPrisma([
      {
        id: 'booking-1',
        checkInAt: new Date('2026-01-31T08:00:00.000Z'),
        member: { membership: { userId: 'user-1', user: { firstName: 'Naz' } } },
      },
    ]);
    const evaluator = new FirstClassFollowUpEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'FIRST_CLASS_FOLLOW_UP', hoursAfter: 24 }, now);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].targetRef).toBe('booking-1');
  });

  it('excludes a first booking whose follow-up window has not elapsed', async () => {
    const prisma = buildPrisma([
      {
        id: 'booking-2',
        checkInAt: new Date('2026-02-01T09:00:00.000Z'),
        member: { membership: { userId: 'user-2', user: { firstName: 'Kerem' } } },
      },
    ]);
    const evaluator = new FirstClassFollowUpEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'FIRST_CLASS_FOLLOW_UP', hoursAfter: 24 }, now);
    expect(candidates).toHaveLength(0);
  });

  it('queries distinct on memberId ordered by earliest check-in', async () => {
    const prisma = buildPrisma([]);
    const evaluator = new FirstClassFollowUpEvaluator(prisma);
    await evaluator.findCandidates('studio-1', { type: 'FIRST_CLASS_FOLLOW_UP', hoursAfter: 24 }, now);
    const call = (prisma.booking.findMany as jest.Mock).mock.calls[0][0];
    expect(call.distinct).toEqual(['memberId']);
    expect(call.orderBy).toEqual([{ memberId: 'asc' }, { checkInAt: 'asc' }]);
  });
});
