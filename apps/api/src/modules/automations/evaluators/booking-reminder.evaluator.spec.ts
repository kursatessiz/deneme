import { BookingReminderEvaluator } from './booking-reminder.evaluator';
import { PrismaService } from '../../prisma/prisma.service';

describe('BookingReminderEvaluator', () => {
  const now = new Date('2026-02-01T10:00:00.000Z');

  it('queries confirmed, non-cancelled bookings within the reminder window and maps template params', async () => {
    const booking = {
      id: 'booking-1',
      schedule: { startTime: new Date('2026-02-01T12:00:00.000Z'), title: 'Grup Reformer', serviceType: { name: 'Grup Reformer' } },
      member: { membership: { userId: 'user-1', user: { firstName: 'Zeynep' } } },
    };
    const findMany = jest.fn().mockResolvedValue([booking]);
    const prisma = { booking: { findMany } } as unknown as PrismaService;

    const evaluator = new BookingReminderEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'BOOKING_REMINDER', hoursBefore: 2 }, now);

    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('CONFIRMED');
    expect(where.schedule.startTime.gt).toEqual(now);
    expect(where.schedule.startTime.lte).toEqual(new Date('2026-02-01T12:00:00.000Z'));

    expect(candidates).toEqual([
      {
        userId: 'user-1',
        targetRef: 'booking-1',
        scheduledFor: booking.schedule.startTime,
        templateParams: expect.objectContaining({ firstName: 'Zeynep', serviceName: 'Grup Reformer' }),
      },
    ]);
  });
});
