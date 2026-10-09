import { Prisma } from '@platform/database';
import { PartnersWebhookService } from './partners-webhook.service';

const body = JSON.stringify({
  eventId: 'evt-1',
  eventType: 'RESERVATION_CREATED',
  timestamp: new Date().toISOString(),
  externalReservationId: 'res-1',
  scheduleId: '11111111-1111-4111-8111-111111111111',
  guest: { fullName: 'Misafir Kisi', phone: '+905550001111' },
});

function build() {
  const stored = new Set<string>();
  const prisma = {
    partnerConnection: { findUnique: jest.fn().mockResolvedValue({ id: 'conn-1', studioId: 'studio-1', provider: 'MOCK' }) },
    partnerWebhookEvent: {
      create: jest.fn().mockImplementation(async ({ data }: { data: { eventId: string } }) => {
        if (stored.has(data.eventId)) {
          throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
        }
        stored.add(data.eventId);
      }),
      deleteMany: jest.fn().mockImplementation(async ({ where }: { where: { eventId: string } }) => {
        stored.delete(where.eventId);
        return { count: 1 };
      }),
    },
    booking: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const connections = { getDecryptedCredentials: jest.fn().mockResolvedValue({ webhookSecret: 's', apiKey: 'k' }) };
  const reservations = {
    createReservation: jest.fn(),
    cancelReservation: jest.fn(),
    recordCheckIn: jest.fn(),
  };
  const registry = { get: jest.fn().mockReturnValue({ verifyWebhookSignature: () => ({ valid: true }) }) };
  const service = new PartnersWebhookService(prisma as never, connections as never, reservations as never, registry as never);
  return { service, prisma, reservations };
}

describe('PartnersWebhookService replay guard', () => {
  it('a failed reservation does not leave the event row behind, so the partner retry is processed', async () => {
    const { service, prisma, reservations } = build();
    reservations.createReservation.mockRejectedValueOnce(new Error('database unavailable'));
    reservations.createReservation.mockResolvedValueOnce({ bookingId: 'b-1', status: 'CONFIRMED', idempotent: false });

    await expect(service.handle('mock', 'conn-1', {}, body)).rejects.toThrow('database unavailable');
    expect(prisma.partnerWebhookEvent.deleteMany).toHaveBeenCalledWith({ where: { connectionId: 'conn-1', eventId: 'evt-1' } });

    const retry = await service.handle('mock', 'conn-1', {}, body);
    expect(retry).toMatchObject({ bookingId: 'b-1', idempotent: false });
    expect(reservations.createReservation).toHaveBeenCalledTimes(2);
  });

  it('a successful event is still answered idempotently when delivered again', async () => {
    const { service, reservations } = build();
    reservations.createReservation.mockResolvedValueOnce({ bookingId: 'b-1', status: 'CONFIRMED', idempotent: false });
    await service.handle('mock', 'conn-1', {}, body);
    const again = await service.handle('mock', 'conn-1', {}, body);
    expect(again.idempotent).toBe(true);
    expect(reservations.createReservation).toHaveBeenCalledTimes(1);
  });
});
