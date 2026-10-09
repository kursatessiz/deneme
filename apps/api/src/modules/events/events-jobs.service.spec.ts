import { EventsJobsService } from './events-jobs.service';

describe('EventsJobsService.sendReminders', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const occurrence = { id: 'occ-1', studioId: 'studio-1', eventId: 'event-1', startsAt: new Date('2026-10-10T10:00:00Z') };

  const build = () => {
    const prisma = {
      eventOccurrence: {
        findMany: jest.fn().mockResolvedValue([occurrence]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      eventRegistration: { findMany: jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]) },
    };
    const seats = { notify: jest.fn().mockResolvedValue(true) };
    return { service: new EventsJobsService(prisma as never, seats as never), prisma, seats };
  };

  it('does not mark the occurrence when the loop crashes, so the remaining registrants are retried', async () => {
    const { service, prisma, seats } = build();
    seats.notify.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('crash'));
    await expect(service.sendReminders(now)).rejects.toThrow('crash');
    expect(prisma.eventOccurrence.updateMany).not.toHaveBeenCalled();

    seats.notify.mockResolvedValue(true);
    await expect(service.sendReminders(now)).resolves.toBe(3);
    expect(prisma.eventOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: 'occ-1', reminderSentAt: null }, data: { reminderSentAt: now } });
    // The same idempotency key is used on the retry, so the first registrant is not messaged twice.
    const keys = seats.notify.mock.calls.filter((c) => c[0] === 'r1').map((c) => c[2]);
    expect(new Set(keys).size).toBe(1);
  });
});
