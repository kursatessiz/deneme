import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { RatingsService } from './ratings.service';

describe('RatingsService', () => {
  let service: RatingsService;
  let prisma: any;
  let notifications: any;

  const STUDIO_ID = 'studio-1';
  const tenant = {
    studioId: STUDIO_ID,
    membershipId: 'membership-1',
    isOwner: false,
    isSuperAdmin: false,
    permissions: new Set<string>(),
    memberProfileId: 'member-1',
    trainerProfileId: null,
    branchIds: null,
  } as any;

  const NOW = new Date('2026-06-15T12:00:00.000Z');
  const sessionEnd = new Date('2026-06-15T10:00:00.000Z'); // 2h before NOW

  const ratingRow = {
    id: 'rating-1',
    studioId: STUDIO_ID,
    bookingId: 'booking-1',
    memberId: 'member-1',
    trainerProfileId: 'trainer-1',
    serviceTypeId: 'service-1',
    score: 5,
    comment: null,
    isAnonymousToTrainer: true,
    createdAt: NOW,
    updatedAt: NOW,
    member: { membership: { user: { firstName: 'Ayse', lastName: 'Yilmaz' } } },
    trainerProfile: { membership: { user: { firstName: 'Can', lastName: 'Demir' } } },
    serviceType: { name: 'Reformer' },
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = {
      booking: { findFirst: jest.fn() },
      sessionRating: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
      membership: { findMany: jest.fn().mockResolvedValue([]) },
      studio: { findUnique: jest.fn().mockResolvedValue({ googleReviewUrl: null }) },
    };
    notifications = { notifyUser: jest.fn() };
    service = new RatingsService(prisma, notifications);
  });

  afterEach(() => jest.useRealTimers());

  it('rejects rating a booking that is not ATTENDED', async () => {
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: 'CONFIRMED',
      schedule: { trainerId: 'trainer-1', endTime: sessionEnd, serviceTypeId: 'service-1' },
      rating: null,
    });

    await expect(service.rate(tenant, 'booking-1', { score: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects rating outside the 7-day window', async () => {
    const oldEnd = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: 'ATTENDED',
      schedule: { trainerId: 'trainer-1', endTime: oldEnd, serviceTypeId: 'service-1' },
      rating: null,
    });

    await expect(service.rate(tenant, 'booking-1', { score: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a second rating on the same booking (409)', async () => {
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: 'ATTENDED',
      schedule: { trainerId: 'trainer-1', endTime: sessionEnd, serviceTypeId: 'service-1' },
      rating: { id: 'existing-rating' },
    });

    await expect(service.rate(tenant, 'booking-1', { score: 5 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('notifies studio owners when the score is low (<=2)', async () => {
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: 'ATTENDED',
      schedule: { trainerId: 'trainer-1', endTime: sessionEnd, serviceTypeId: 'service-1' },
      rating: null,
    });
    prisma.sessionRating.create.mockResolvedValue({ ...ratingRow, score: 1 });
    prisma.membership.findMany.mockResolvedValue([{ userId: 'owner-user-1' }]);

    await service.rate(tenant, 'booking-1', { score: 1, comment: 'Kotuydu' });

    expect(notifications.notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-user-1', category: 'FEEDBACK' }),
    );
  });

  it('does not notify owners for a good score', async () => {
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: 'ATTENDED',
      schedule: { trainerId: 'trainer-1', endTime: sessionEnd, serviceTypeId: 'service-1' },
      rating: null,
    });
    prisma.sessionRating.create.mockResolvedValue({ ...ratingRow, score: 5 });

    await service.rate(tenant, 'booking-1', { score: 5 });

    expect(notifications.notifyUser).not.toHaveBeenCalled();
  });

  it('returns a review prompt only for score >= 4 and only when the URL is set', async () => {
    prisma.studio.findUnique.mockResolvedValue({ googleReviewUrl: 'https://g.page/r/abc/review' });
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: 'ATTENDED',
      schedule: { trainerId: 'trainer-1', endTime: sessionEnd, serviceTypeId: 'service-1' },
      rating: null,
    });
    prisma.sessionRating.create.mockResolvedValue({ ...ratingRow, score: 4 });

    const result = await service.rate(tenant, 'booking-1', { score: 4 });

    expect(result.reviewPrompt).toEqual({ googleReviewUrl: 'https://g.page/r/abc/review' });
  });

  it('omits the review prompt below the good-score threshold even when the URL is set', async () => {
    prisma.studio.findUnique.mockResolvedValue({ googleReviewUrl: 'https://g.page/r/abc/review' });
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: 'ATTENDED',
      schedule: { trainerId: 'trainer-1', endTime: sessionEnd, serviceTypeId: 'service-1' },
      rating: null,
    });
    prisma.sessionRating.create.mockResolvedValue({ ...ratingRow, score: 3 });

    const result = await service.rate(tenant, 'booking-1', { score: 3 });

    expect(result.reviewPrompt).toBeNull();
  });

  it('anonymizes the member identity in the trainer own-view when isAnonymousToTrainer is true', async () => {
    const trainerTenant = { ...tenant, memberProfileId: null, trainerProfileId: 'trainer-1' };
    prisma.sessionRating.findMany.mockResolvedValue([ratingRow]);

    const result = await service.myReceivedSummary(trainerTenant);

    expect(result.items[0].memberName).toBeNull();
  });

  it('reveals the member identity when isAnonymousToTrainer is false', async () => {
    const trainerTenant = { ...tenant, memberProfileId: null, trainerProfileId: 'trainer-1' };
    prisma.sessionRating.findMany.mockResolvedValue([{ ...ratingRow, isAnonymousToTrainer: false }]);

    const result = await service.myReceivedSummary(trainerTenant);

    expect(result.items[0].memberName).toBe('Ayse Yilmaz');
  });

  it('rejects a booking without an assigned trainer', async () => {
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: 'ATTENDED',
      schedule: { trainerId: null, endTime: sessionEnd, serviceTypeId: 'service-1' },
      rating: null,
    });

    await expect(service.rate(tenant, 'booking-1', { score: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects rating another member\'s booking (not found for this member)', async () => {
    prisma.booking.findFirst.mockResolvedValue(null);

    await expect(service.rate(tenant, 'booking-1', { score: 5 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
