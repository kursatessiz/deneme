import { ReferralsService } from './referrals.service';

describe('ReferralsService', () => {
  let service: ReferralsService;
  let prisma: any;

  const STUDIO_ID = 'studio-1';

  beforeEach(() => {
    prisma = {
      referralCode: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
      memberProfile: { findUnique: jest.fn(), findFirst: jest.fn() },
      membership: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      referral: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      payment: { findFirst: jest.fn() },
      booking: { findFirst: jest.fn() },
      studio: { findUnique: jest.fn() },
      memberPackage: { findFirst: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    service = new ReferralsService(prisma);
  });

  describe('recordReferral (self-referral guard)', () => {
    it('does not create a referral when the referred user is the referrer', async () => {
      prisma.referralCode.findFirst.mockResolvedValue({ id: 'code-1', memberId: 'member-referrer' });
      prisma.memberProfile.findUnique.mockResolvedValue({ membershipId: 'membership-1' });
      prisma.membership.findUnique.mockResolvedValue({ userId: 'user-same' });

      await service.recordReferral(prisma, STUDIO_ID, 'user-same', 'ABCD1234');

      expect(prisma.referral.create).not.toHaveBeenCalled();
    });

    it('creates a PENDING referral for a genuinely different referred user', async () => {
      prisma.referralCode.findFirst.mockResolvedValue({ id: 'code-1', memberId: 'member-referrer' });
      prisma.memberProfile.findUnique.mockResolvedValue({ membershipId: 'membership-1' });
      prisma.membership.findUnique.mockResolvedValue({ userId: 'user-referrer' });
      prisma.user.findUnique.mockResolvedValue({ phone: '+905321112233' });

      await service.recordReferral(prisma, STUDIO_ID, 'user-referred', 'abcd1234');

      expect(prisma.referral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            studioId: STUDIO_ID,
            referrerMemberId: 'member-referrer',
            referredUserId: 'user-referred',
            status: 'PENDING',
          }),
        }),
      );
    });

    it('silently ignores an unknown referral code', async () => {
      prisma.referralCode.findFirst.mockResolvedValue(null);

      await service.recordReferral(prisma, STUDIO_ID, 'user-referred', 'NOPE');

      expect(prisma.referral.create).not.toHaveBeenCalled();
    });

    it('swallows a duplicate-referral unique violation (same phone recorded twice)', async () => {
      prisma.referralCode.findFirst.mockResolvedValue({ id: 'code-1', memberId: 'member-referrer' });
      prisma.memberProfile.findUnique.mockResolvedValue({ membershipId: 'membership-1' });
      prisma.membership.findUnique.mockResolvedValue({ userId: 'user-referrer' });
      prisma.user.findUnique.mockResolvedValue({ phone: '+905321112233' });
      const { Prisma } = require('@platform/database');
      prisma.referral.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(service.recordReferral(prisma, STUDIO_ID, 'user-referred', 'ABCD1234')).resolves.toBeUndefined();
    });
  });

  describe('reward granted exactly once under parallel qualification', () => {
    const referral = { id: 'ref-1', studioId: STUDIO_ID, referrerMemberId: 'member-referrer', status: 'QUALIFIED' };

    it('only the first of two concurrent grant attempts credits the package', async () => {
      prisma.studio.findUnique.mockResolvedValue({ referralRewardUnits: 2 });
      // First call: conditional update succeeds (this call "wins" the race).
      // Second call: someone else already flipped the status, count 0.
      prisma.referral.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      prisma.referral.findUniqueOrThrow.mockResolvedValue(referral);
      prisma.memberPackage.findFirst.mockResolvedValue({
        id: 'pkg-1',
        totalUnits: 10,
        remainingUnits: 5,
      });

      await Promise.all([
        (service as any).grantReward(STUDIO_ID, referral.id),
        (service as any).grantReward(STUDIO_ID, referral.id),
      ]);

      expect(prisma.memberPackage.update).toHaveBeenCalledTimes(1);
      expect(prisma.memberPackage.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { totalUnits: { increment: 2 }, remainingUnits: { increment: 2 } } }),
      );
    });
  });

  describe('referrer without an unexpired package', () => {
    const referral = { id: 'ref-1', studioId: STUDIO_ID, referrerMemberId: 'member-referrer', status: 'QUALIFIED' };

    it('looks only for ACTIVE packages whose end date is still in the future', async () => {
      prisma.studio.findUnique.mockResolvedValue({ referralRewardUnits: 2 });
      prisma.referral.updateMany.mockResolvedValue({ count: 1 });
      prisma.referral.findUniqueOrThrow.mockResolvedValue(referral);
      prisma.memberPackage.findFirst.mockResolvedValue(null);

      await (service as any).grantReward(STUDIO_ID, referral.id);

      const where = prisma.memberPackage.findFirst.mock.calls[0][0].where;
      expect(where.status).toBe('ACTIVE');
      expect(where.endDate.gt).toBeInstanceOf(Date);
    });

    it('does not finish the reward (transaction aborted, no audit row) when no package can be credited', async () => {
      prisma.studio.findUnique.mockResolvedValue({ referralRewardUnits: 2 });
      prisma.referral.updateMany.mockResolvedValue({ count: 1 });
      prisma.referral.findUniqueOrThrow.mockResolvedValue(referral);
      prisma.memberPackage.findFirst.mockResolvedValue(null);
      // Model the rollback: a callback that throws leaves the status untouched in the database.
      prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

      await expect((service as any).grantReward(STUDIO_ID, referral.id)).resolves.toBeUndefined();

      expect(prisma.memberPackage.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      // The transaction callback rejected, which is what makes the database roll the REWARDED update back.
      await expect(prisma.$transaction.mock.results[0].value).rejects.toBeDefined();
    });

    it('still rewards a referral that carries no unit reward', async () => {
      prisma.studio.findUnique.mockResolvedValue({ referralRewardUnits: 0 });
      prisma.referral.updateMany.mockResolvedValue({ count: 1 });
      prisma.referral.findUniqueOrThrow.mockResolvedValue(referral);

      await (service as any).grantReward(STUDIO_ID, referral.id);

      expect(prisma.referral.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.memberPackage.findFirst).not.toHaveBeenCalled();
    });
  });
});
