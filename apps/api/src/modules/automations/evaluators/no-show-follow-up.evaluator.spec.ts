import { NoShowFollowUpEvaluator } from './no-show-follow-up.evaluator';
import { PrismaService } from '../../prisma/prisma.service';

describe('NoShowFollowUpEvaluator', () => {
  const now = new Date('2026-02-01T10:00:00.000Z');

  it('only includes no-shows whose session started at least hoursAfter ago', async () => {
    const dueBooking = {
      id: 'booking-due',
      schedule: { startTime: new Date('2026-02-01T07:00:00.000Z'), title: 'Mat Pilates', serviceType: null },
      member: { membership: { userId: 'user-1', user: { firstName: 'Burak' } } },
    };
    const findMany = jest.fn().mockResolvedValue([dueBooking]);
    const prisma = { booking: { findMany } } as unknown as PrismaService;

    const evaluator = new NoShowFollowUpEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'NO_SHOW_FOLLOW_UP', hoursAfter: 2 }, now);

    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('NO_SHOW');
    // dueBy = now - 2h
    expect(where.schedule.startTime.lte).toEqual(new Date('2026-02-01T08:00:00.000Z'));

    expect(candidates).toEqual([
      expect.objectContaining({ userId: 'user-1', targetRef: 'booking-due', templateParams: expect.objectContaining({ serviceName: 'Mat Pilates' }) }),
    ]);
  });
});
