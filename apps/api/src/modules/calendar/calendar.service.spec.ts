import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CalendarService } from './calendar.service';
import { MeBookingsService } from './me-bookings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CalendarService', () => {
  let service: CalendarService;

  const mockPrisma = {
    calendarFeedToken: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
    },
  };

  const mockMeBookings = {
    memberProfileIdsFor: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MeBookingsService, useValue: mockMeBookings },
        {
          provide: ConfigService,
          useValue: {
            get: (_key: string, fallback?: string) => fallback ?? 'https://api.example.com',
            getOrThrow: () => 'https://api.example.com',
          },
        },
      ],
    }).compile();

    service = module.get<CalendarService>(CalendarService);
    jest.clearAllMocks();
  });

  describe('rotate', () => {
    it('creates a new token, stores only its sha256 hash, and returns https + webcal URLs once', async () => {
      mockPrisma.calendarFeedToken.upsert.mockImplementation(async ({ create }: { create: { tokenHash: string } }) => ({
        id: 'row-1',
        userId: 'user-1',
        tokenHash: create.tokenHash,
        createdAt: new Date('2026-09-24T00:00:00.000Z'),
        lastUsedAt: null,
      }));

      const result = await service.rotate('user-1');

      expect(mockPrisma.calendarFeedToken.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrisma.calendarFeedToken.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ userId: 'user-1' });
      // The raw token must never be sent to storage, only its hash.
      expect(call.create.tokenHash).toHaveLength(64);
      expect(call.create.tokenHash).not.toEqual(expect.stringContaining(result.url));

      const rawTokenFromUrl = result.url.split('/calendar/')[1].replace('.ics', '');
      expect(createHash('sha256').update(rawTokenFromUrl).digest('hex')).toBe(call.create.tokenHash);
      expect(result.webcalUrl).toBe(result.url.replace(/^https?:\/\//, 'webcal://'));
      expect(result.createdAt).toBe('2026-09-24T00:00:00.000Z');
    });
  });

  describe('revoke', () => {
    it('deletes the caller feed token', async () => {
      await service.revoke('user-1');
      expect(mockPrisma.calendarFeedToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });
  });

  describe('resolveUserId', () => {
    it('returns null for an unknown token', async () => {
      mockPrisma.calendarFeedToken.findUnique.mockResolvedValueOnce(null);
      expect(await service.resolveUserId('deadbeef'.repeat(8))).toBeNull();
    });

    it('resolves a known token by its hash and touches lastUsedAt', async () => {
      const rawToken = 'a'.repeat(64);
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      mockPrisma.calendarFeedToken.findUnique.mockImplementation(async ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash === tokenHash ? { id: 'row-1', userId: 'user-1' } : null,
      );
      mockPrisma.calendarFeedToken.update.mockResolvedValueOnce({});

      const userId = await service.resolveUserId(rawToken);
      expect(userId).toBe('user-1');
      expect(mockPrisma.calendarFeedToken.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: { lastUsedAt: expect.any(Date) },
      });
    });
  });

  describe('buildIcsForUser', () => {
    it('returns an empty calendar for a user with no member profiles', async () => {
      mockMeBookings.memberProfileIdsFor.mockResolvedValueOnce([]);
      const ics = await service.buildIcsForUser('user-1');
      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).not.toContain('BEGIN:VEVENT');
      expect(mockPrisma.booking.findMany).not.toHaveBeenCalled();
    });

    it('renders confirmed and cancelled bookings with the right ICS status', async () => {
      mockMeBookings.memberProfileIdsFor.mockResolvedValueOnce(['member-1']);
      mockPrisma.booking.findMany.mockResolvedValueOnce([
        {
          id: 'booking-1',
          status: 'CONFIRMED',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          studio: { name: 'Sube A' },
          schedule: {
            startTime: new Date('2026-10-01T09:00:00.000Z'),
            endTime: new Date('2026-10-01T10:00:00.000Z'),
            serviceType: { name: 'Reformer Pilates' },
            branch: { name: 'Merkez' },
          },
        },
        {
          id: 'booking-2',
          status: 'CANCELLED_LATE',
          createdAt: new Date('2026-09-02T00:00:00.000Z'),
          studio: { name: 'Sube A' },
          schedule: {
            startTime: new Date('2026-09-10T09:00:00.000Z'),
            endTime: new Date('2026-09-10T10:00:00.000Z'),
            serviceType: { name: 'Mat Pilates' },
            branch: null,
          },
        },
      ]);

      const ics = await service.buildIcsForUser('user-1');
      expect(ics).toContain('UID:booking-booking-1@platform');
      expect(ics).toContain('STATUS:CONFIRMED');
      expect(ics).toContain('UID:booking-booking-2@platform');
      expect(ics).toContain('STATUS:CANCELLED');
      expect(ics).toContain('LOCATION:Merkez');
      // Booking without a branch falls back to the studio name as location.
      expect(ics).toContain('LOCATION:Sube A');
    });
  });
});
