import { BadRequestException } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import type { IssueGiftCardInput } from '@platform/shared';

describe('PromotionsService - issueGiftCard currency', () => {
  let service: PromotionsService;
  let prisma: any;
  let giftCardCreate: jest.Mock;
  let paymentCreate: jest.Mock;

  const tenant: TenantContext = {
    studioId: 'studio-1',
    membershipId: 'membership-1',
    isOwner: true,
    isSuperAdmin: false,
    permissions: new Set(['packages.sell']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  };
  const dto = { studioId: 'studio-1', memberId: 'member-1', initialAmount: 100, currency: 'TRY', paymentMethod: 'CASH' } as unknown as IssueGiftCardInput;

  beforeEach(() => {
    giftCardCreate = jest.fn().mockResolvedValue({ id: 'gc-1', last4: '1234' });
    paymentCreate = jest.fn().mockResolvedValue({ id: 'payment-1' });
    prisma = {
      memberProfile: { findFirst: jest.fn().mockResolvedValue({ homeBranchId: null, membership: { userId: 'user-1' } }) },
      studio: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currency: 'EUR' }),
        findUnique: jest.fn().mockResolvedValue({ defaultLocale: 'tr' }),
      },
      $transaction: jest.fn(async (cb) => cb({ giftCard: { create: giftCardCreate }, payment: { create: paymentCreate }, giftCardTransaction: { create: jest.fn() } })),
    };
    service = new PromotionsService(prisma as unknown as PrismaService);
  });

  it('rejects a currency that differs from the business currency', async () => {
    await expect(service.issueGiftCard(tenant, 'user-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(giftCardCreate).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('stores the card and its payment in the business currency', async () => {
    await service.issueGiftCard(tenant, 'user-1', { ...dto, currency: 'eur' });
    expect(giftCardCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currency: 'EUR' }) }));
    expect(paymentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currency: 'EUR' }) }));
  });
});
